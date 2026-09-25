import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

const MIGRATIONS_ROOT = path.resolve(import.meta.dirname, "../../migrations");
export const GLOBAL_MIGRATIONS = path.join(MIGRATIONS_ROOT, "global");
export const TENANT_MIGRATIONS = path.join(MIGRATIONS_ROOT, "tenant");

// Evita que dos instancias del backend migren la misma base al mismo tiempo.
const MIGRATION_LOCK_ID = 727_001;

/**
 * Aplica, en orden alfabético, los archivos .sql de `dir` que aún no estén
 * registrados en schema_migrations. Cada archivo corre en su propia transacción.
 */
export async function runMigrations(pool: pg.Pool, dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}
