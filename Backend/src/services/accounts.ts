import type pg from "pg";
import { config } from "../config.js";
import { globalPool } from "../db/pool.js";
import { HttpError } from "../errors.js";
import type { Role } from "./auth.js";

/**
 * Dónde viven las cuentas de un ámbito. Las dos tablas (global_admins y users
 * de cada tenant) tienen las mismas columnas de login, 2FA y contraseña.
 */
export interface AccountStore {
  pool: pg.Pool;
  table: "global_admins" | "users";
  /** Texto que la app de autenticación muestra junto a la cuenta. */
  issuer: string;
}

export interface Account {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  last_role: string | null;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  password_changed_at: Date;
  totp_secret: string | null;
  totp_enabled_at: Date | null;
  totp_last_step: string | null;
  recovery_codes: string[];
}

export const issuerFor = (organization?: string) =>
  organization ? `${config.mfaIssuer} (${organization})` : config.mfaIssuer;

/** Cuentas del equipo BeeHives (global_admin). */
export const globalAccounts: AccountStore = { pool: globalPool, table: "global_admins", issuer: issuerFor("Admin") };

// global_admins no tiene columna de roles: su único rol es global_admin.
const accountColumns = (store: AccountStore) => `id, email, name, password_hash, is_active, must_change_password,
  password_changed_at, totp_secret, totp_enabled_at, totp_last_step, recovery_codes,
  ${store.table === "users" ? "roles, last_role" : "ARRAY['global_admin'] AS roles, NULL AS last_role"}`;

/** Cuenta activa por email (para el login). */
export async function findAccountByEmail(store: AccountStore, email: string): Promise<Account | undefined> {
  const res = await store.pool.query<Account>(
    `SELECT ${accountColumns(store)} FROM ${store.table} WHERE lower(email) = $1 AND is_active`,
    [email],
  );
  return res.rows[0];
}

/** Cuenta por id, activa o no (el llamador decide qué hacer si está inactiva). */
export async function findAccount(store: AccountStore, id: string): Promise<Account | undefined> {
  const res = await store.pool.query<Account>(`SELECT ${accountColumns(store)} FROM ${store.table} WHERE id = $1`, [id]);
  return res.rows[0];
}

/** Cuenta activa por id durante el flujo de login; si no existe, el token intermedio ya no sirve. */
export async function findAccountById(store: AccountStore, id: string): Promise<Account> {
  const account = await findAccount(store, id);
  if (!account?.is_active) throw new HttpError(401, "La verificación expiró. Vuelve a iniciar sesión.", "mfa_expired");
  return account;
}

/**
 * Cambia la contraseña. `mustChange` = true la deja como temporal (reseteo por un admin).
 * password_changed_at se fija con el reloj del backend (el mismo que firma los tokens),
 * así las sesiones emitidas antes del cambio quedan invalidadas.
 */
export async function setPassword(store: AccountStore, id: string, hash: string, mustChange: boolean): Promise<boolean> {
  const res = await store.pool.query(
    `UPDATE ${store.table}
     SET password_hash = $2, must_change_password = $3, password_changed_at = $4
     WHERE id = $1`,
    [id, hash, mustChange, new Date()],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Recuerda el último rol con el que trabajó (solo usuarios de empresa). */
export async function setLastRole(store: AccountStore, id: string, role: Role) {
  if (store.table !== "users") return;
  await store.pool.query("UPDATE users SET last_role = $2 WHERE id = $1", [id, role]);
}

/** Activa o desactiva una cuenta. Al desactivar se cierran sus sesiones. */
export async function setAccountActive(store: AccountStore, id: string, active: boolean): Promise<boolean> {
  const res = await store.pool.query(
    `UPDATE ${store.table}
     SET is_active = $2, password_changed_at = CASE WHEN $2 THEN password_changed_at ELSE $3 END
     WHERE id = $1`,
    [id, active, new Date()],
  );
  return (res.rowCount ?? 0) > 0;
}
