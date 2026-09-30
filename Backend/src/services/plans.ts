import { globalPool } from "../db/pool.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import type { LegalFramework } from "./channel.js";
import type { Tenant } from "./tenants.js";

/**
 * Planes comerciales (base global). Cada empresa tiene uno y define qué marcos legales, módulos y límites tiene.
 * Reglas al cambiar de plan: nunca se borra nada. Lo que el plan ya no incluye deja de mostrarse y no se puede
 * crear de nuevo, pero lo existente se conserva (usuarios, categorías, denuncias en curso con sus plazos legales,
 * evidencias ya recibidas, marca y flujos ya guardados).
 */

export const PLAN_FRAMEWORKS = ["ley_karin", "ley_20393", "ley_21719", "internal"] as const satisfies readonly LegalFramework[];

export const PLAN_FEATURES = [
  "evidence",
  "custom_flows",
  "branding",
  "custom_smtp",
  "reporter_authenticator",
  "reports",
  "register_cases",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_LIMITS = ["max_users", "max_areas", "max_categories"] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  frameworks: LegalFramework[];
  features: PlanFeature[];
  max_users: number | null;
  max_areas: number | null;
  max_categories: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PlanInput {
  name: string;
  description: string | null;
  frameworks: LegalFramework[];
  features: PlanFeature[];
  maxUsers: number | null;
  maxAreas: number | null;
  maxCategories: number | null;
  isActive?: boolean;
}

export async function listPlans(): Promise<(Plan & { tenants: number })[]> {
  const res = await globalPool.query<Plan & { tenants: number }>(
    `SELECT p.*, (SELECT count(*)::int FROM tenants t WHERE t.plan_id = p.id) AS tenants
       FROM plans p ORDER BY p.is_active DESC, lower(p.name)`,
  );
  return res.rows;
}

export async function getPlan(id: string): Promise<Plan> {
  const plan = (await globalPool.query<Plan>("SELECT * FROM plans WHERE id = $1", [id])).rows[0];
  if (!plan) throw new HttpError(404, "Plan no encontrado");
  return plan;
}

/** Plan vigente de la empresa (se consulta en cada uso: un cambio de plan aplica de inmediato). */
export async function planOf(tenant: Pick<Tenant, "plan_id">): Promise<Plan> {
  return getPlan(tenant.plan_id);
}

function checkInput(input: PlanInput) {
  if (!input.frameworks.length) throw new HttpError(400, "El plan debe incluir al menos un marco legal.");
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  checkInput(input);
  try {
    const res = await globalPool.query<Plan>(
      `INSERT INTO plans (name, description, frameworks, features, max_users, max_areas, max_categories)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [input.name, input.description, input.frameworks, input.features, input.maxUsers, input.maxAreas, input.maxCategories],
    );
    return res.rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe un plan llamado "${input.name}".`);
    throw err;
  }
}

export async function updatePlan(id: string, input: PlanInput): Promise<Plan> {
  checkInput(input);
  const before = await getPlan(id);
  if (input.isActive === false && before.is_active) {
    const used = await globalPool.query("SELECT 1 FROM tenants WHERE plan_id = $1 LIMIT 1", [id]);
    if (used.rowCount) throw new HttpError(409, "Hay empresas con este plan: cámbialas a otro antes de desactivarlo.");
  }
  try {
    const res = await globalPool.query<Plan>(
      `UPDATE plans SET name = $2, description = $3, frameworks = $4, features = $5, max_users = $6, max_areas = $7,
              max_categories = $8, is_active = $9, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [
        id,
        input.name,
        input.description,
        input.frameworks,
        input.features,
        input.maxUsers,
        input.maxAreas,
        input.maxCategories,
        input.isActive ?? before.is_active,
      ],
    );
    return res.rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe un plan llamado "${input.name}".`);
    throw err;
  }
}

export async function deletePlan(id: string): Promise<Plan> {
  const plan = await getPlan(id);
  const used = await globalPool.query("SELECT 1 FROM tenants WHERE plan_id = $1 LIMIT 1", [id]);
  if (used.rowCount) throw new HttpError(409, "Hay empresas con este plan: cámbialas a otro antes de eliminarlo.");
  await globalPool.query("DELETE FROM plans WHERE id = $1", [id]);
  return plan;
}

/* ------------------------------------------------------------------ Verificaciones para los servicios */

const FEATURE_LABEL: Record<PlanFeature, string> = {
  evidence: "Evidencias adjuntas",
  custom_flows: "Flujos de gestión editables",
  branding: "Marca propia",
  custom_smtp: "Correo saliente propio",
  reporter_authenticator: "App de autenticación del denunciante",
  reports: "Reportes",
  register_cases: "Registro de denuncias recibidas por otras vías",
};

const FRAMEWORK_LABEL: Record<LegalFramework, string> = {
  ley_karin: "Ley Karin",
  ley_20393: "Ley 20.393",
  ley_21719: "Ley 21.719",
  internal: "Normativa interna",
};

export const hasFeature = (plan: Plan, feature: PlanFeature) => plan.features.includes(feature);
export const hasFramework = (plan: Plan, framework: LegalFramework) => plan.frameworks.includes(framework);

/** 403 si el plan de la empresa no incluye el módulo. */
export async function requireFeature(tenant: Pick<Tenant, "plan_id">, feature: PlanFeature): Promise<Plan> {
  const plan = await planOf(tenant);
  if (!hasFeature(plan, feature)) {
    throw new HttpError(403, `${FEATURE_LABEL[feature]} no está incluido en el plan de la empresa.`, "plan_feature");
  }
  return plan;
}

/** 403 si el plan no incluye el marco legal. */
export async function requireFramework(tenant: Pick<Tenant, "plan_id">, framework: LegalFramework): Promise<Plan> {
  const plan = await planOf(tenant);
  if (!hasFramework(plan, framework)) {
    throw new HttpError(403, `${FRAMEWORK_LABEL[framework]} no está incluida en el plan de la empresa.`, "plan_framework");
  }
  return plan;
}

const LIMIT_TEXT: Record<PlanLimit, (n: number) => string> = {
  max_users: (n) => `El plan de la empresa permite hasta ${n} usuarios activos.`,
  max_areas: (n) => `El plan de la empresa permite hasta ${n} áreas.`,
  max_categories: (n) => `El plan de la empresa permite hasta ${n} categorías activas.`,
};

/** 403 si agregar uno más superaría el límite del plan (`current` es lo que ya existe). */
export async function requireBelowLimit(tenant: Pick<Tenant, "plan_id">, limit: PlanLimit, current: number): Promise<void> {
  const max = (await planOf(tenant))[limit];
  if (max !== null && current >= max) throw new HttpError(403, LIMIT_TEXT[limit](max), "plan_limit");
}

/** Lo que el frontend necesita saber del plan (sin datos comerciales internos). */
export function planForClient(plan: Plan) {
  return {
    name: plan.name,
    frameworks: plan.frameworks,
    features: plan.features,
    limits: { maxUsers: plan.max_users, maxAreas: plan.max_areas, maxCategories: plan.max_categories },
  };
}
