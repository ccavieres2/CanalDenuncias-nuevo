import { config } from "../config.js";
import { TENANT_MIGRATIONS, runMigrations } from "../db/migrate.js";
import {
  type DbTarget,
  closeTenantPool,
  createDatabase,
  dropDatabase,
  getTenantPool,
  globalPool,
} from "../db/pool.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { type AccountStore, issuerFor } from "./accounts.js";
import { hashPassword } from "./auth.js";
import { generateTemporaryPassword } from "./passwords.js";

export type TenantStatus = "provisioning" | "active" | "suspended";

export interface TenantProfile {
  legal_name: string | null;
  tax_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

export interface Tenant extends TenantProfile {
  id: string;
  name: string;
  slug: string;
  db_name: string;
  db_host: string;
  db_port: number;
  status: TenantStatus;
  created_at: Date;
  updated_at: Date;
}

export interface ClientAdmin {
  id: string;
  email: string;
  name: string;
  role: "client_admin";
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
  last_login_at: Date | null;
  mfa_enabled: boolean;
}

export interface NewAccount {
  name: string;
  email: string;
}

/** Credenciales iniciales: se muestran una sola vez a quien creó la cuenta. */
export interface IssuedCredentials {
  email: string;
  temporaryPassword: string;
}

/** Minúsculas, números y guiones; sin guion al inicio ni al final; 2 a 40 caracteres. */
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
/** Slugs que chocarían con rutas propias de la aplicación. */
// «plataforma» es la carpeta de archivos de BeeHives (p. ej., auditoría archivada) en el almacenamiento.
export const RESERVED_SLUGS = new Set(["admin", "api", "login", "logout", "www", "app", "static", "assets", "plataforma"]);

export const tenantTarget = (t: Tenant): DbTarget => ({ host: t.db_host, port: t.db_port, database: t.db_name });
export const tenantPool = (t: Tenant) => getTenantPool(tenantTarget(t));
/** Cuentas de la empresa, para el login y el 2FA. */
export const tenantAccounts = (t: Tenant): AccountStore => ({
  pool: tenantPool(t),
  table: "users",
  issuer: issuerFor(t.name),
});

const TENANT_COLUMNS = `id, name, slug, db_name, db_host, db_port, status, created_at, updated_at,
  legal_name, tax_id, contact_name, contact_email, contact_phone, notes`;
const CLIENT_ADMIN_COLUMNS = `id, email, name, 'client_admin' AS role, is_active, must_change_password, created_at, last_login_at,
  (totp_enabled_at IS NOT NULL) AS mfa_enabled`;

/** Campos editables de la ficha: nombre de la API → columna. */
const PROFILE_FIELDS = {
  name: "name",
  legalName: "legal_name",
  taxId: "tax_id",
  contactName: "contact_name",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
  notes: "notes",
} as const;
export type TenantProfileInput = Partial<Record<keyof typeof PROFILE_FIELDS, string | null>>;

export async function listTenants(): Promise<Tenant[]> {
  const res = await globalPool.query<Tenant>(`SELECT ${TENANT_COLUMNS} FROM tenants ORDER BY created_at DESC`);
  return res.rows;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  const res = await globalPool.query<Tenant>(`SELECT ${TENANT_COLUMNS} FROM tenants WHERE slug = $1`, [slug]);
  return res.rows[0] ?? null;
}

export async function getTenantOr404(slug: string): Promise<Tenant> {
  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw new HttpError(404, "Empresa no encontrada");
  return tenant;
}

/**
 * Da de alta una empresa: la registra en la base global, crea su propia base
 * de datos, le aplica las migraciones de tenant y crea su primer client_admin
 * con una contraseña temporal. Si algo falla a mitad de camino se deshace todo.
 */
export async function createTenant(
  input: { name: string; slug: string; admin: NewAccount } & TenantProfileInput,
): Promise<{ tenant: Tenant; credentials: IssuedCredentials }> {
  if (RESERVED_SLUGS.has(input.slug)) throw new HttpError(409, `El slug "${input.slug}" está reservado`);

  const dbName = config.tenantDbPrefix + input.slug.replace(/-/g, "_");
  let tenant: Tenant;
  try {
    const res = await globalPool.query<Tenant>(
      `INSERT INTO tenants (name, slug, db_name, db_host, db_port, status,
                            legal_name, tax_id, contact_name, contact_email, contact_phone, notes)
       VALUES ($1, $2, $3, $4, $5, 'provisioning', $6, $7, $8, $9, $10, $11)
       RETURNING ${TENANT_COLUMNS}`,
      [
        input.name,
        input.slug,
        dbName,
        config.tenantDbHost,
        config.tenantDbPort,
        input.legalName ?? null,
        input.taxId ?? null,
        input.contactName ?? null,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        input.notes ?? null,
      ],
    );
    tenant = res.rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe una empresa con el slug "${input.slug}"`);
    throw err;
  }

  let databaseCreated = false;
  try {
    await createDatabase(tenant.db_host, tenant.db_port, tenant.db_name);
    databaseCreated = true;
    await runMigrations(tenantPool(tenant), TENANT_MIGRATIONS);
    const { credentials } = await insertClientAdmin(tenant, input.admin);

    const res = await globalPool.query<Tenant>(
      `UPDATE tenants SET status = 'active', updated_at = now() WHERE id = $1 RETURNING ${TENANT_COLUMNS}`,
      [tenant.id],
    );
    return { tenant: res.rows[0]!, credentials };
  } catch (err) {
    await closeTenantPool(tenantTarget(tenant)).catch(() => {});
    if (databaseCreated) {
      await dropDatabase(tenant.db_host, tenant.db_port, tenant.db_name).catch((e) =>
        console.error(`No se pudo borrar la base ${tenant.db_name} tras un error:`, e),
      );
    }
    await globalPool.query("DELETE FROM tenants WHERE id = $1", [tenant.id]).catch(() => {});
    throw err;
  }
}

/** Actualiza la ficha de la empresa. Devuelve la empresa y los campos que cambiaron. */
export async function updateTenantProfile(
  slug: string,
  input: TenantProfileInput,
): Promise<{ tenant: Tenant; changed: string[] }> {
  const before = await getTenantOr404(slug);
  const sets: string[] = [];
  const params: unknown[] = [slug];
  const changed: string[] = [];

  for (const [key, column] of Object.entries(PROFILE_FIELDS) as [keyof typeof PROFILE_FIELDS, string][]) {
    if (!(key in input)) continue;
    const value = input[key] ?? null;
    if ((before as unknown as Record<string, unknown>)[column] === value) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
    changed.push(key);
  }
  if (!sets.length) return { tenant: before, changed };

  const res = await globalPool.query<Tenant>(
    `UPDATE tenants SET ${sets.join(", ")}, updated_at = now() WHERE slug = $1 RETURNING ${TENANT_COLUMNS}`,
    params,
  );
  return { tenant: res.rows[0]!, changed };
}

export async function setTenantStatus(slug: string, status: "active" | "suspended"): Promise<Tenant> {
  const res = await globalPool.query<Tenant>(
    `UPDATE tenants SET status = $2, updated_at = now()
     WHERE slug = $1 AND status <> 'provisioning'
     RETURNING ${TENANT_COLUMNS}`,
    [slug, status],
  );
  if (!res.rows[0]) throw new HttpError(404, "Empresa no encontrada");
  return res.rows[0];
}

export async function listClientAdmins(tenant: Tenant): Promise<ClientAdmin[]> {
  const res = await tenantPool(tenant).query<ClientAdmin>(
    `SELECT ${CLIENT_ADMIN_COLUMNS} FROM users WHERE 'client_admin' = ANY(roles) ORDER BY created_at`,
  );
  return res.rows;
}

export async function getClientAdmin(tenant: Tenant, id: string): Promise<ClientAdmin> {
  const res = await tenantPool(tenant).query<ClientAdmin>(`SELECT ${CLIENT_ADMIN_COLUMNS} FROM users WHERE id = $1`, [id]);
  if (!res.rows[0]) throw new HttpError(404, "Administrador no encontrado");
  return res.rows[0];
}

/** Crea un client_admin con contraseña temporal (deberá cambiarla en su primer ingreso). */
export async function insertClientAdmin(
  tenant: Tenant,
  user: NewAccount,
): Promise<{ admin: ClientAdmin; credentials: IssuedCredentials }> {
  const temporaryPassword = generateTemporaryPassword();
  try {
    const res = await tenantPool(tenant).query<ClientAdmin>(
      `INSERT INTO users (email, name, password_hash, roles, must_change_password)
       VALUES ($1, $2, $3, ARRAY['client_admin'], true)
       RETURNING ${CLIENT_ADMIN_COLUMNS}`,
      [user.email, user.name, await hashPassword(temporaryPassword)],
    );
    return { admin: res.rows[0]!, credentials: { email: user.email, temporaryPassword } };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe un usuario con el email ${user.email}`);
    throw err;
  }
}

/** Cuántos client_admin activos tiene la empresa (para no dejarla sin ninguno). */
export async function countActiveClientAdmins(tenant: Tenant): Promise<number> {
  const res = await tenantPool(tenant).query<{ count: string }>(
    "SELECT count(*) FROM users WHERE 'client_admin' = ANY(roles) AND is_active",
  );
  return Number(res.rows[0]!.count);
}

/** Aplica migraciones pendientes a todas las bases de tenant (se llama al arrancar). */
export async function migrateAllTenants(): Promise<void> {
  const tenants = (await listTenants()).filter((t) => t.status !== "provisioning");
  for (const tenant of tenants) {
    const applied = await runMigrations(tenantPool(tenant), TENANT_MIGRATIONS);
    if (applied.length) console.log(`[migraciones] ${tenant.slug}: ${applied.join(", ")}`);
  }
}
