import { type Request, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireRole } from "../middleware/auth.js";
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
import { passwordSchema } from "../services/passwords.js";

interface AuthScope {
  /** Roles que pueden usar este flujo (para las rutas que exigen sesión). */
  roles: readonly Role[];
  /** Base de datos y tabla donde están las cuentas de este ámbito. */
  store: (req: Request) => AccountStore;
  /** "global" o el slug de la empresa; amarra el token intermedio a este ámbito. */
  scope: (req: Request) => string;
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

// Frena ataques de fuerza bruta contra contraseñas y códigos 2FA.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." },
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
 *
 * Una persona puede tener varios roles; el token lleva el rol activo y los permisos
 * se evalúan con él.
 */
export function authFlowRouter({ roles, store, scope }: AuthScope): Router {
  const router = Router({ mergeParams: true });
  const tenantOf = (req: Request) => (scope(req) === "global" ? undefined : scope(req));

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
      token: signAccessToken({ sub: account.id, role, tenant: tenantOf(req) }),
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
    res.json({ token: signAccessToken({ sub: account.id, role: req.actor!.role, tenant: tenantOf(req) }) });
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
    res.json({ token: signAccessToken({ sub: account.id, role: role as Role, tenant: tenantOf(req) }) });
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
