import type { RequestHandler } from "express";
import { HttpError } from "../errors.js";
import { findAccount, globalAccounts } from "../services/accounts.js";
import { type AccessPayload, type Role, verifyAccessToken } from "../services/auth.js";
import { checkSameOrigin, requestToken } from "../services/session-cookie.js";
import { type Tenant, tenantAccounts } from "../services/tenants.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessPayload & { iat?: number };
      /** Usuario autenticado (para auditoría y respuestas). */
      actor?: { id: string; email: string; name: string; role: Role };
      tenant?: Tenant;
    }
  }
}


/**
 * Exige una sesión válida cuyo rol activo (el elegido al ingresar) sea alguno de los
 * indicados. Los permisos dependen del rol activo; además se revisa en la base que:
 * - la persona siga teniendo ese rol (quitarle un rol corta ese acceso de inmediato),
 * - la cuenta siga activa (desactivar a alguien corta su acceso de inmediato),
 * - la sesión sea posterior al último cambio/reseteo de contraseña,
 * - no tenga un cambio de contraseña pendiente (salvo en las rutas que lo permiten).
 */
export function requireRole(
  roles: Role | readonly Role[],
  { allowPendingPasswordChange = false } = {},
): RequestHandler {
  const allowed = new Set<Role>(typeof roles === "string" ? [roles] : roles);
  return async (req, _res, next) => {
    const found = requestToken(req);
    const payload = found && (verifyAccessToken(found.token) as (AccessPayload & { iat?: number }) | null);
    if (!found || !payload) throw new HttpError(401, "No autenticado");
    // La cookie viaja sola: se exige que la petición venga de esta misma aplicación (CSRF).
    if (found.via === "cookie") checkSameOrigin(req);
    // Un token de empresa no sirve en la consola global, ni en otra empresa, ni al revés.
    if (req.tenant ? payload.tenant !== req.tenant.slug : payload.role !== "global_admin") {
      throw new HttpError(403, "No autorizado");
    }

    const store = req.tenant ? tenantAccounts(req.tenant) : globalAccounts;
    const account = await findAccount(store, payload.sub);
    if (!account?.is_active) throw new HttpError(401, "Tu sesión ya no es válida. Vuelve a iniciar sesión.", "session_revoked");
    if ((payload.iat ?? 0) < Math.floor(account.password_changed_at.getTime() / 1000)) {
      throw new HttpError(401, "Tu sesión ya no es válida. Vuelve a iniciar sesión.", "session_revoked");
    }
    const activeRole = payload.role;
    if (!account.roles.includes(activeRole)) {
      throw new HttpError(401, "Tus roles cambiaron. Vuelve a iniciar sesión.", "session_revoked");
    }
    if (!allowed.has(activeRole)) throw new HttpError(403, "No tienes permiso para realizar esta acción", "forbidden");
    if (account.must_change_password && !allowPendingPasswordChange) {
      throw new HttpError(403, "Debes cambiar tu contraseña antes de continuar.", "password_change_required");
    }

    req.auth = payload;
    req.actor = { id: account.id, email: account.email, name: account.name, role: activeRole };
    next();
  };
}
