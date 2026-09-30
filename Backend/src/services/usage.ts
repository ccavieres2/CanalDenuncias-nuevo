import { getBranding } from "./branding.js";
import { getPlan } from "./plans.js";
import { storage } from "../storage/index.js";
import { type Tenant, listTenants, tenantPool } from "./tenants.js";

/**
 * Consumo de cada empresa, para la consola BeeHives (precios y capacidad). Solo cifras: nunca contenido de
 * denuncias ni datos de personas. Las denuncias de ejemplo se informan aparte y no cuentan en los totales.
 */

export interface TenantUsage {
  slug: string;
  name: string;
  status: Tenant["status"];
  plan: string;
  cases: {
    total: number;
    open: number;
    closed: number;
    thisMonth: number;
    last30Days: number;
    byFramework: Record<string, number>;
    demo: number;
  };
  files: { evidenceCount: number; evidenceBytes: number; logoBytes: number; totalBytes: number };
  databaseBytes: number;
  /** Base de datos + archivos. */
  storageBytes: number;
  users: { active: number; total: number };
  areas: number;
  categories: number;
  /** null si no se pudo medir (por ejemplo, la base no responde). */
  error: string | null;
}

async function logoBytes(tenant: Tenant): Promise<number> {
  const { logo } = await getBranding(tenant);
  if (!logo) return 0;
  return (await storage.get(logo.key).catch(() => null))?.length ?? 0;
}

export async function tenantUsage(tenant: Tenant): Promise<TenantUsage> {
  const pool = tenantPool(tenant);
  const base = { slug: tenant.slug, name: tenant.name, status: tenant.status, plan: (await getPlan(tenant.plan_id)).name };
  try {
    const [counts, frameworks, files, logo] = await Promise.all([
      pool.query<{
        db: string;
        total: number;
        open: number;
        closed: number;
        this_month: number;
        last30: number;
        demo: number;
        users_active: number;
        users_total: number;
        areas: number;
        categories: number;
      }>(
        `SELECT pg_database_size(current_database()) AS db,
                count(*) FILTER (WHERE NOT is_demo)::int AS total,
                count(*) FILTER (WHERE NOT is_demo AND status <> 'closed')::int AS open,
                count(*) FILTER (WHERE NOT is_demo AND status = 'closed')::int AS closed,
                count(*) FILTER (WHERE NOT is_demo AND received_at >= date_trunc('month', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago')::int AS this_month,
                count(*) FILTER (WHERE NOT is_demo AND received_at >= now() - interval '30 days')::int AS last30,
                count(*) FILTER (WHERE is_demo)::int AS demo,
                (SELECT count(*) FILTER (WHERE is_active)::int FROM users) AS users_active,
                (SELECT count(*)::int FROM users) AS users_total,
                (SELECT count(*)::int FROM areas) AS areas,
                (SELECT count(*) FILTER (WHERE is_active)::int FROM categories) AS categories
           FROM cases`,
      ),
      pool.query<{ framework: string; n: number }>(
        `SELECT cat.legal_framework AS framework, count(*)::int AS n
           FROM cases c JOIN categories cat ON cat.id = c.category_id
          WHERE NOT c.is_demo GROUP BY 1`,
      ),
      pool.query<{ n: number; bytes: string }>("SELECT count(*)::int AS n, COALESCE(sum(size_bytes), 0) AS bytes FROM case_files"),
      logoBytes(tenant),
    ]);
    const r = counts.rows[0]!;
    const evidenceBytes = Number(files.rows[0]!.bytes);
    const databaseBytes = Number(r.db);
    return {
      ...base,
      cases: {
        total: r.total,
        open: r.open,
        closed: r.closed,
        thisMonth: r.this_month,
        last30Days: r.last30,
        byFramework: Object.fromEntries(frameworks.rows.map((f) => [f.framework, f.n])),
        demo: r.demo,
      },
      files: { evidenceCount: files.rows[0]!.n, evidenceBytes, logoBytes: logo, totalBytes: evidenceBytes + logo },
      databaseBytes,
      storageBytes: databaseBytes + evidenceBytes + logo,
      users: { active: r.users_active, total: r.users_total },
      areas: r.areas,
      categories: r.categories,
      error: null,
    };
  } catch (err) {
    console.error(`[consumo] no se pudo medir ${tenant.slug}:`, err);
    return {
      ...base,
      cases: { total: 0, open: 0, closed: 0, thisMonth: 0, last30Days: 0, byFramework: {}, demo: 0 },
      files: { evidenceCount: 0, evidenceBytes: 0, logoBytes: 0, totalBytes: 0 },
      databaseBytes: 0,
      storageBytes: 0,
      users: { active: 0, total: 0 },
      areas: 0,
      categories: 0,
      error: "No se pudo medir el consumo de esta empresa.",
    };
  }
}

/** Consumo de todas las empresas (las que se están creando no se miden). */
export async function listUsage(): Promise<TenantUsage[]> {
  const tenants = (await listTenants()).filter((t) => t.status !== "provisioning");
  return Promise.all(tenants.map(tenantUsage));
}
