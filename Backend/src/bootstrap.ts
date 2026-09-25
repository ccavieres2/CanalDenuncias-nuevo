import { config } from "./config.js";
import { GLOBAL_MIGRATIONS, runMigrations } from "./db/migrate.js";
import { createDatabase, databaseExists, globalPool } from "./db/pool.js";
import { hashPassword } from "./services/auth.js";
import { migrateLegacyLogos } from "./services/branding.js";
import { migrateAllTenants } from "./services/tenants.js";
import { storage } from "./storage/index.js";

/**
 * Deja la base lista antes de aceptar requests. Es idempotente, así que sirve
 * igual para un Postgres recién creado en Docker que para un RDS vacío.
 */
export async function bootstrap(): Promise<void> {
  const { host, port } = config.db;
  if (!(await databaseExists(host, port, config.globalDbName))) {
    console.log(`[bootstrap] Creando base global "${config.globalDbName}"`);
    await createDatabase(host, port, config.globalDbName);
  }

  const applied = await runMigrations(globalPool, GLOBAL_MIGRATIONS);
  if (applied.length) console.log(`[migraciones] global: ${applied.join(", ")}`);

  await migrateAllTenants();
  console.log(`[almacenamiento] archivos en ${storage.name}`);
  await migrateLegacyLogos();
  await seedInitialGlobalAdmin();
}

async function seedInitialGlobalAdmin(): Promise<void> {
  const { rows } = await globalPool.query<{ count: string }>("SELECT count(*) FROM global_admins");
  if (Number(rows[0]!.count) > 0) return;

  const { email, password, name } = config.initialGlobalAdmin;
  if (!email || !password) {
    console.warn("[bootstrap] No hay global_admin. Define GLOBAL_ADMIN_EMAIL y GLOBAL_ADMIN_PASSWORD para crearlo.");
    return;
  }
  // Contraseña de variable de entorno = temporal: se exige cambiarla en el primer ingreso.
  await globalPool.query(
    "INSERT INTO global_admins (email, name, password_hash, must_change_password) VALUES ($1, $2, $3, true)",
    [email.toLowerCase(), name, await hashPassword(password)],
  );
  console.log(`[bootstrap] global_admin inicial creado: ${email}`);
}
