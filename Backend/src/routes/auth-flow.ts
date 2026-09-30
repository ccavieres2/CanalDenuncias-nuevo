import { type Request, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireRole } from "../middleware/auth.js";
import type { Tenant } from "../services/tenants.js";
import { type AccountStore, findAccountByEmail, findAccountById, setLastRole, setPassword } from "../services/accounts.js";
import { audit } from "../services/audit.js";
import {
  type Role,
  defaultRole,
  hashPassword,
  signAccessToken,
  signMfaToken,
  verifyMfaToken,
  verifyPassword,
} from "../services/auth.js";
import { beginTotpSetup, completeTotpSetup, regenerateRecoveryCodes, verifySecondFactor } from "../services/mfa.js";
import { completePasswordReset, requestPasswordReset, verifyResetCode } from "../services/password-reset.js";
import { passwordSchema } from "../services/passwords.js";
import { clearSession, issueSession } from "../services/session-cookie.js";

interface AuthScope {
  /** Roles que pueden usar este flujo (para las rutas que exigen sesión). */
  roles: readonly Role[];
  /** Base de datos y tabla donde están las cuentas de este ámbito. */
  store: (req: Request) => AccountStore;
  /** "global" o el slug de la empresa; amarra el token intermedio a este ámbito. */
  scope: (req: Request) => string;
  /** Nombre que aparece en los correos (la empresa o «Consola de administración»). */
  organization: (req: Request) => string;
  /** Página de ingreso de este ámbito (para los enlaces de los correos). */
  loginPath: (req: Request) => string;
  /** Empresa del ámbito (sus correos usan su SMTP); ausente en la consola de la plataforma. */
  tenant?: (req: Request) => Tenant;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido"),
  password: z.string().min(1, "Ingresa la contraseña"),
});
const mfaTokenSchema = z.object({ mfaToken: z.string().min(1) });
const verifySchema = mfaTokenSchema.extend({ code: z.string().trim().min(6, "Ingresa el código").max(20) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Ingresa tu contraseña actual"),
  newPassword: passwordSchema,
});
const codeSchema = z.object({ code: z.string().trim().min(6, "Ingresa el código").max(6) });
const switchRoleSchema = z.object({ role: z.string().min(1) });
const resetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email("Email inválido") });
const resetVerifySchema = resetRequestSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 dígitos"),
});
const resetCompleteSchema = z.object({ resetToken: z.string().min(1), newPassword: passwordSchema });

// Frena ataques de fuerza bruta contra contraseñas y códigos 2FA.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." },
});

// Solicitudes de código por correo: más estricto, para que no se use para enviar correos masivos.
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Espera unos minutos antes de pedir otro código." },
});

/**
 * Inicio de sesión en dos pasos, igual para el global_admin y para cada empresa:
 *
 *   POST /login            email + contraseña    → mfaToken + si debe "setup" o "verify"
 *   POST /mfa/setup        mfaToken              → QR para Authenticator (solo la primera vez)
 *   POST /mfa/verify       mfaToken + código     → token de sesión (+ códigos de recuperación la primera vez)
 *   POST /change-password  sesión                → obligatorio si la contraseña es temporal
 *   POST /recovery-codes   sesión + código       → nuevo juego de códigos de recuperación
 *   POST /switch-role      sesión + rol          → sesión nueva con otro de sus roles
 *   POST /logout                                 → borra la cookie de sesión
 *
 * La sesión viaja en una cookie HttpOnly (ver session-cookie.ts); el campo `token` de las respuestas es solo un
 * marcador, salvo que se pida «X-Session-Mode: bearer».
 *
 * Recuperación de contraseña (sin sesión; el 2FA se sigue pidiendo al ingresar):
 *   POST /password-reset/request   email            → envía un código de 6 dígitos al correo (respuesta siempre igual)
 *   POST /password-reset/verify    email + código   → resetToken
 *   POST /password-reset/complete  resetToken + contraseña nueva
 *
 * Una persona puede tener varios roles; el token lleva el rol activo y los permisos
 * se evalúan con él.
 */
export function authFlowRouter({ roles, store, scope, organization, loginPath, tenant }: AuthScope): Router {
  const router = Router({ mergeParams: true });
  const tenantOf = (req: Request) => (scope(req) === "global" ? undefined : scope(req));
  const resetContext = (req: Request) => ({
    store: store(req),
    tenant: tenant?.(req),
    organization: organization(req),
    loginPath: loginPath(req),
  });

  async function accountFromMfaToken(req: Request) {
    const { mfaToken } = mfaTokenSchema.parse(req.body);
    const payload = verifyMfaToken(mfaToken, scope(req));
    if (!payload) throw new HttpError(401, "La verificación expiró. Vuelve a iniciar sesión.", "mfa_expired");
    return findAccountById(store(req), payload.sub);
  }

  router.post("/login", authLimiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const account = await findAccountByEmail(store(req), email);
    if (!(await verifyPassword(password, account?.password_hash)) || !account) {
      await audit(req, {
        action: "auth.login_failed",
        actor: { id: account?.id ?? null, email },
        tenantSlug: tenantOf(req),
        metadata: { reason: "password" },
      });
      throw new HttpError(401, "Email o contraseña incorrectos");
    }
    res.json({
      mfa: account.totp_enabled_at ? "verify" : "setup",
      mfaToken: signMfaToken({ sub: account.id, scope: scope(req) }),
      user: { name: account.name, email: account.email },
    });
  });

  router.post("/mfa/setup", authLimiter, async (req, res) => {
    const account = await accountFromMfaToken(req);
    res.json(await beginTotpSetup(store(req), account));
  });

  router.post("/mfa/verify", authLimiter, async (req, res) => {
    const { code } = verifySchema.parse(req.body);
    const account = await accountFromMfaToken(req);
    const accounts = store(req);
    const actor = { id: account.id, email: account.email };

    let recoveryCodes: string[] | undefined;
    let method: string;
    try {
      if (account.totp_enabled_at) {
        method = await verifySecondFactor(accounts, account, code);
      } else {
        recoveryCodes = await completeTotpSetup(accounts, account, code);
        method = "totp";
        await audit(req, { action: "auth.mfa_enrolled", actor, tenantSlug: tenantOf(req) });
      }
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        await audit(req, { action: "auth.mfa_failed", actor, tenantSlug: tenantOf(req) });
      }
      throw err;
    }

    const role = defaultRole(account.roles, account.last_role);
    await accounts.pool.query(`UPDATE ${accounts.table} SET last_login_at = now() WHERE id = $1`, [account.id]);
    await audit(req, { action: "auth.login", actor: { ...actor, role }, tenantSlug: tenantOf(req), metadata: { method } });
    res.json({
      token: issueSession(req, res, signAccessToken({ sub: account.id, role, tenant: tenantOf(req) }), tenantOf(req)),
      user: { id: account.id, name: account.name, email: account.email, role, roles: account.roles },
      mustChangePassword: account.must_change_password,
      recoveryCodes,
    });
  });

  router.post("/change-password", requireRole(roles, { allowPendingPasswordChange: true }), async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const accounts = store(req);
    const account = await findAccountById(accounts, req.auth!.sub);

    if (!(await verifyPassword(currentPassword, account.password_hash))) {
      throw new HttpError(400, "La contraseña actual no es correcta", "invalid_current_password");
    }
    if (currentPassword === newPassword) {
      throw new HttpError(400, "La nueva contraseña debe ser distinta de la actual");
    }

    await setPassword(accounts, account.id, await hashPassword(newPassword), false);
    await audit(req, { action: "auth.password_changed", tenantSlug: tenantOf(req) });
    // El cambio invalida las sesiones anteriores; se entrega una nueva para seguir trabajando.
    res.json({
      token: issueSession(req, res, signAccessToken({ sub: account.id, role: req.actor!.role, tenant: tenantOf(req) }), tenantOf(req)),
    });
  });

  router.post("/switch-role", requireRole(roles), async (req, res) => {
    const { role } = switchRoleSchema.parse(req.body);
    const accounts = store(req);
    const account = await findAccountById(accounts, req.auth!.sub);
    if (!account.roles.includes(role as Role)) throw new HttpError(403, "No tienes ese rol", "forbidden");

    const from = req.actor!.role;
    await setLastRole(accounts, account.id, role as Role);
    if (from !== role) {
      await audit(req, {
        action: "auth.role_switched",
        actor: { id: account.id, email: account.email, role },
        tenantSlug: tenantOf(req),
        metadata: { from, to: role },
      });
    }
    res.json({
      token: issueSession(req, res, signAccessToken({ sub: account.id, role: role as Role, tenant: tenantOf(req) }), tenantOf(req)),
    });
  });

  // Cierra la sesión del navegador (borra la cookie). No exige sesión: salir siempre debe funcionar.
  router.post("/logout", (req, res) => {
    clearSession(res, tenantOf(req));
    res.json({ ok: true });
  });

  router.post("/password-reset/request", resetRequestLimiter, async (req, res) => {
    const { email } = resetRequestSchema.parse(req.body);
    // Se responde de inmediato y el correo sale en segundo plano: así la respuesta (y lo que tarda) es la misma
    // exista o no la cuenta, y nadie puede averiguar qué correos están registrados.
    requestPasswordReset(resetContext(req), email)
      .then(async (account) => {
        if (account) {
          await audit(req, {
            action: "auth.password_reset_requested",
            actor: { id: account.id, email: account.email },
            tenantSlug: tenantOf(req),
          });
        }
      })
      .catch((err) => console.error(`[recuperación] no se pudo enviar el código: ${(err as Error).message}`));
    res.json({ ok: true });
  });

  router.post("/password-reset/verify", authLimiter, async (req, res) => {
    const { email, code } = resetVerifySchema.parse(req.body);
    try {
      const { resetToken } = await verifyResetCode(store(req), scope(req), email, code);
      res.json({ resetToken });
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) {
        await audit(req, { action: "auth.password_reset_failed", actor: { id: null, email }, tenantSlug: tenantOf(req) });
      }
      throw err;
    }
  });

  router.post("/password-reset/complete", authLimiter, async (req, res) => {
    const { resetToken, newPassword } = resetCompleteSchema.parse(req.body);
    const account = await completePasswordReset(resetContext(req), scope(req), resetToken, newPassword);
    await audit(req, {
      action: "auth.password_reset",
      actor: { id: account.id, email: account.email },
      tenantSlug: tenantOf(req),
    });
    res.json({ ok: true });
  });

  router.post("/recovery-codes", authLimiter, requireRole(roles), async (req, res) => {
    const { code } = codeSchema.parse(req.body);
    const accounts = store(req);
    const recoveryCodes = await regenerateRecoveryCodes(accounts, await findAccountById(accounts, req.auth!.sub), code);
    await audit(req, { action: "auth.recovery_codes_regenerated", tenantSlug: tenantOf(req) });
    res.json({ recoveryCodes });
  });

  return router;
}
