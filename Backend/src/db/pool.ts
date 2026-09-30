import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "../config.js";

export interface DbTarget {
  host: string;
  port: number;
  database: string;
}

/**
 * TLS hacia PostgreSQL. Con DB_SSL=true se valida el certificado: con el CA de DB_SSL_CA_FILE (en RDS, el bundle
 * de Amazon: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) o, si no, con los CA del sistema.
 */
const ssl = config.db.ssl
  ? {
      rejectUnauthorized: config.db.sslVerify,
      ca: config.db.sslCaFile ? readFileSync(config.db.sslCaFile, "utf8") : undefined,
    }
  : undefined;
if (config.db.ssl && !config.db.sslVerify) {
  console.warn("[db] ADVERTENCIA: DB_SSL_VERIFY=false, no se verifica el certificado de la base de datos.");
}

function connectionOptions(target: DbTarget) {
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: config.db.user,
    password: config.db.password,
    ssl,
  };
}

/**
 * Una conexión inactiva puede cortarse desde el servidor (reinicio o failover de RDS, base eliminada).
 * Sin este listener, pg emite un 'error' no manejado y el proceso completo se cae; con él, el pool
 * descarta esa conexión y abre otra en la siguiente consulta.
 */
function logIdleErrors(pool: pg.Pool, database: string): pg.Pool {
  pool.on("error", (err) => console.warn(`[db] conexión inactiva cerrada en ${database}: ${err.message}`));
  return pool;
}

/** Base de control: global_admins y el catálogo de tenants. */
export const globalPool = logIdleErrors(
  new pg.Pool({
    ...connectionOptions({ host: config.db.host, port: config.db.port, database: config.globalDbName }),
    max: 10,
  }),
  config.globalDbName,
);

// Un pool por base de tenant, creado bajo demanda y reutilizado.
const tenantPools = new Map<string, pg.Pool>();

const poolKey = (t: DbTarget) => `${t.host}:${t.port}/${t.database}`;

export function getTenantPool(target: DbTarget): pg.Pool {
  const key = poolKey(target);
  let pool = tenantPools.get(key);
  if (!pool) {
    pool = logIdleErrors(new pg.Pool({ ...connectionOptions(target), max: 5, idleTimeoutMillis: 30_000 }), target.database);
    tenantPools.set(key, pool);
  }
  return pool;
}

export async function closeTenantPool(target: DbTarget): Promise<void> {
  const key = poolKey(target);
  const pool = tenantPools.get(key);
  if (pool) {
    tenantPools.delete(key);
    await pool.end();
  }
}

/** Ejecuta fn con una conexión a la base de mantenimiento ("postgres") del servidor indicado. */
async function withMaintenance<T>(host: string, port: number, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(connectionOptions({ host, port, database: config.db.maintenanceDb }));
  client.on("error", (err) => console.warn(`[db] conexión de mantenimiento cerrada: ${err.message}`));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function databaseExists(host: string, port: number, name: string): Promise<boolean> {
  return withMaintenance(host, port, async (c) => {
    const res = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    return (res.rowCount ?? 0) > 0;
  });
}

export async function createDatabase(host: string, port: number, name: string): Promise<void> {
  await withMaintenance(host, port, (c) => c.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`));
}

export async function dropDatabase(host: string, port: number, name: string): Promise<void> {
  await withMaintenance(host, port, (c) =>
    c.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`),
  );
}
