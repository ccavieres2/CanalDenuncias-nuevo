import { auditStorageStatus } from "./audit-maintenance.js";
import { readdir } from "node:fs/promises";
import { TENANT_MIGRATIONS } from "../db/migrate.js";
import { globalPool } from "../db/pool.js";
import { listAuditEvents } from "./audit.js";
import { type Tenant, listTenants, tenantPool } from "./tenants.js";

/** Tiempo máximo para consultar una base de tenant antes de darla por no disponible. */
const TENANT_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Sin respuesta en ${ms} ms`)), ms)),
  ]);
}

interface TenantUserStats {
  admins: number;
  activeAdmins: number;
  mfaPending: number;
}

async function tenantUserStats(tenant: Tenant): Promise<TenantUserStats> {
  const res = await tenantPool(tenant).query<{ admins: string; active: string; pending: string }>(
    `SELECT count(*) AS admins,
            count(*) FILTER (WHERE is_active) AS active,
            count(*) FILTER (WHERE is_active AND totp_enabled_at IS NULL) AS pending
     FROM users WHERE 'client_admin' = ANY(roles)`,
  );
  const row = res.rows[0]!;
  return { admins: Number(row.admins), activeAdmins: Number(row.active), mfaPending: Number(row.pending) };
}

/** Datos del panel "Resumen" de la consola. */
export async function getOverview() {
  const tenants = await listTenants();
  const live = tenants.filter((t) => t.status !== "provisioning");
  const stats = await Promise.allSettled(live.map((t) => withTimeout(tenantUserStats(t), TENANT_TIMEOUT_MS)));

  let admins = 0;
  let mfaPending = 0;
  let unreachable = 0;
  const attention: { slug: string; name: string; reason: string }[] = [];
  stats.forEach((result, i) => {
    const tenant = live[i]!;
    if (result.status === "rejected") {
      unreachable++;
      attention.push({ slug: tenant.slug, name: tenant.name, reason: "Base de datos no disponible" });
      return;
    }
    admins += result.value.admins;
    mfaPending += result.value.mfaPending;
    if (tenant.status === "active" && result.value.activeAdmins === 0) {
      attention.push({ slug: tenant.slug, name: tenant.name, reason: "Sin administradores activos" });
    }
  });

  const [team, activity] = await Promise.all([
    globalPool.query<{ total: string; pending: string }>(
      `SELECT count(*) FILTER (WHERE is_active) AS total,
              count(*) FILTER (WHERE is_active AND totp_enabled_at IS NULL) AS pending
       FROM global_admins`,
    ),
    globalPool.query<{ logins: string; failed: string }>(
      `SELECT count(*) FILTER (WHERE action = 'auth.login') AS logins,
              count(*) FILTER (WHERE action IN ('auth.login_failed', 'auth.mfa_failed')) AS failed
       FROM audit_events WHERE occurred_at > now() - interval '24 hours'`,
    ),
  ]);

  return {
    tenants: {
      total: tenants.length,
      active: tenants.filter((t) => t.status === "active").length,
      suspended: tenants.filter((t) => t.status === "suspended").length,
    },
    clientAdmins: { total: admins, mfaPending },
    team: { total: Number(team.rows[0]!.total), mfaPending: Number(team.rows[0]!.pending) },
    last24h: { logins: Number(activity.rows[0]!.logins), failedLogins: Number(activity.rows[0]!.failed) },
    unreachableTenants: unreachable,
    attention,
    recentTenants: tenants.slice(0, 5).map((t) => ({ name: t.name, slug: t.slug, status: t.status, createdAt: t.created_at })),
    recentActivity: (await listAuditEvents({ limit: 8 })).events,
  };
}

/** Estado técnico de la plataforma: base global y cada base de tenant. */
export async function getSystemStatus() {
  const expectedMigrations = (await readdir(TENANT_MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
  const latestMigration = expectedMigrations[expectedMigrations.length - 1] ?? null;

  const started = Date.now();
  const global = await globalPool.query<{ version: string; size: string; migration: string | null }>(
    `SELECT current_setting('server_version') AS version,
            pg_database_size(current_database()) AS size,
            (SELECT max(name) FROM schema_migrations) AS migration`,
  );
  const globalLatency = Date.now() - started;

  const tenants = (await listTenants()).filter((t) => t.status !== "provisioning");
  const checks = await Promise.allSettled(
    tenants.map((t) =>
      withTimeout(
        (async () => {
          const t0 = Date.now();
          const res = await tenantPool(t).query<{ size: string; applied: string[]; users: string }>(
            `SELECT pg_database_size(current_database()) AS size,
                    (SELECT array_agg(name ORDER BY name) FROM schema_migrations) AS applied,
                    (SELECT count(*) FROM users) AS users`,
          );
          return { latency: Date.now() - t0, row: res.rows[0]! };
        })(),
        TENANT_TIMEOUT_MS,
      ),
    ),
  );

  const audit = await auditStorageStatus();

  return {
    audit,
    database: {
      host: tenants[0]?.db_host ?? null,
      version: global.rows[0]!.version,
      globalSizeBytes: Number(global.rows[0]!.size),
      globalMigration: global.rows[0]!.migration,
      latencyMs: globalLatency,
    },
    tenantSchema: { latest: latestMigration, total: expectedMigrations.length },
    tenants: tenants.map((t, i) => {
      const check = checks[i]!;
      const base = { slug: t.slug, name: t.name, status: t.status, dbName: t.db_name, dbHost: t.db_host };
      if (check.status === "rejected") {
        return { ...base, reachable: false, error: String((check.reason as Error)?.message ?? check.reason) };
      }
      const applied = check.value.row.applied ?? [];
      return {
        ...base,
        reachable: true,
        latencyMs: check.value.latency,
        sizeBytes: Number(check.value.row.size),
        users: Number(check.value.row.users),
        migration: applied[applied.length - 1] ?? null,
        pendingMigrations: expectedMigrations.filter((m) => !applied.includes(m)),
      };
    }),
    checkedAt: new Date(),
  };
}
