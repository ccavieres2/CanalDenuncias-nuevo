import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

/** Roles de una empresa. Solo client_admin configura el canal; el resto gestionará denuncias. */
export const TENANT_ROLES = ["client_admin", "case_manager", "investigator", "resolver", "auditor"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export type Role = "global_admin" | TenantRole;

/** Rol por defecto al iniciar sesión: el último usado si aún lo tiene; si no, el primero en este orden. */
export function defaultRole(roles: readonly Role[], lastRole: string | null): Role {
  if (lastRole && roles.includes(lastRole as Role)) return lastRole as Role;
  const order: Role[] = ["global_admin", ...TENANT_ROLES];
  return order.find((r) => roles.includes(r)) ?? roles[0]!;
}

/** Token de sesión: se entrega solo después de pasar contraseña + 2FA. */
export interface AccessPayload {
  typ: "access";
  sub: string;
  role: Role;
  /** Slug del tenant; solo para usuarios de una empresa. */
  tenant?: string;
}

/**
 * Token intermedio: prueba que la contraseña fue correcta y solo sirve para
 * configurar o verificar el 2FA. Dura pocos minutos.
 */
export interface MfaPayload {
  typ: "mfa";
  sub: string;
  /** "global" o el slug de la empresa. */
  scope: string;
}

const BCRYPT_ROUNDS = 12;
const MFA_TOKEN_TTL = "10m";
// Se compara contra este hash cuando el email no existe, para que la respuesta
// tarde lo mismo y no se pueda averiguar qué emails están registrados.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_ROUNDS);

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return ok && hash !== undefined;
}

export function signAccessToken(payload: Omit<AccessPayload, "typ">): string {
  return jwt.sign({ ...payload, typ: "access" }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function signMfaToken(payload: Omit<MfaPayload, "typ">): string {
  return jwt.sign({ ...payload, typ: "mfa" }, config.jwtSecret, { expiresIn: MFA_TOKEN_TTL });
}

function verify(token: string): Record<string, unknown> | null {
  try {
    return jwt.verify(token, config.jwtSecret) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string): AccessPayload | null {
  const payload = verify(token);
  return payload?.typ === "access" ? (payload as unknown as AccessPayload) : null;
}

export function verifyMfaToken(token: string, scope: string): MfaPayload | null {
  const payload = verify(token);
  return payload?.typ === "mfa" && payload.scope === scope ? (payload as unknown as MfaPayload) : null;
}

/**
 * Sesión del denunciante en el portal: solo da acceso a su denuncia, en su empresa, por 30 minutos.
 * Se obtiene con la clave de seguimiento o con el código de la app de autenticación.
 */
export interface ReporterPayload {
  typ: "reporter";
  /** Id de la denuncia. */
  sub: string;
  tenant: string;
}

export function signReporterToken(caseId: string, tenant: string): string {
  return jwt.sign({ typ: "reporter", sub: caseId, tenant }, config.jwtSecret, { expiresIn: "30m" });
}

export function verifyReporterToken(token: string, tenant: string): ReporterPayload | null {
  const payload = verify(token);
  return payload?.typ === "reporter" && payload.tenant === tenant ? (payload as unknown as ReporterPayload) : null;
}
