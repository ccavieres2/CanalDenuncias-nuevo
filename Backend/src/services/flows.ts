import { randomBytes } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { addBusinessDays, addCalendarDays } from "./calendar.js";
import type { LegalFramework } from "./channel.js";
import { type Tenant, tenantPool } from "./tenants.js";

/**
 * Flujos de gestión de la empresa (ISO 37002: el proceso de denuncias lo define y aprueba la organización).
 *
 * Quién hace qué:
 *   - client_admin: edita las PLANTILLAS (plazos de referencia y pasos propios). Cada cambio crea una versión nueva
 *     y aplica solo a las denuncias nuevas; las que están en curso siguen con la versión con que partieron.
 *   - Gestor de denuncias: en un caso puntual agrega tareas y extiende plazos internos (con motivo).
 *   - Ley Karin: nadie la edita (el procedimiento y sus plazos los fija la ley).
 *   - En Ley 20.393 y 21.719 los hitos legales quedan fijos; la empresa solo agrega pasos propios.
 */

export type FlowFramework = "ley_20393" | "ley_21719" | "internal";
export const FLOW_FRAMEWORKS: FlowFramework[] = ["ley_20393", "ley_21719", "internal"];
export const isFlowFramework = (f: string): f is FlowFramework => (FLOW_FRAMEWORKS as string[]).includes(f);

export type DayKind = "calendar" | "business";
export type StepOwner = "case_manager" | "investigator";

export interface FlowStep {
  key: string;
  title: string;
  description: string | null;
  /** Plazo en días desde la recepción; null = sin plazo. */
  days: number | null;
  dayKind: DayKind;
  /** Obligatorio: no se puede aprobar el cierre sin registrarlo. */
  required: boolean;
  owner: StepOwner;
}

export interface FlowConfig {
  /** Acuse de recibo al denunciante (referencia ISO 37002: 7 días). */
  ackDays: number;
  /** Respuesta al denunciante y cierre (referencia ISO 37002: 3 meses). */
  closureDays: number;
  dayKind: DayKind;
  steps: FlowStep[];
}

/** Flujo recomendado de la plataforma (el que usa una empresa que no ha editado el suyo). */
export const DEFAULT_FLOW: FlowConfig = { ackDays: 7, closureDays: 90, dayKind: "calendar", steps: [] };

export const addDays = (from: Date, days: number, kind: DayKind) =>
  kind === "business" ? addBusinessDays(from, days) : addCalendarDays(from, days);
export const daysLabel = (days: number, kind: DayKind) =>
  `${days} ${days === 1 ? "día" : "días"} ${kind === "business" ? (days === 1 ? "hábil" : "hábiles") : days === 1 ? "corrido" : "corridos"}`;

/** Forma canónica (orden de claves fijo): la base (jsonb) reordena las claves, así se comparan sin falsos cambios. */
export const canonicalFlow = (c: FlowConfig): string =>
  JSON.stringify({
    ackDays: c.ackDays,
    closureDays: c.closureDays,
    dayKind: c.dayKind,
    steps: c.steps.map((s) => ({
      key: s.key,
      title: s.title,
      description: s.description ?? null,
      days: s.days ?? null,
      dayKind: s.dayKind,
      required: s.required,
      owner: s.owner,
    })),
  });

export interface FlowTemplateRow {
  id: string;
  framework: FlowFramework;
  version: number;
  config: FlowConfig;
  note: string | null;
  created_by: string | null;
  created_at: Date;
}

export async function listTemplates(db: pg.Pool | pg.PoolClient): Promise<FlowTemplateRow[]> {
  return (await db.query<FlowTemplateRow>("SELECT * FROM flow_templates ORDER BY framework, version")).rows;
}

/** Plantilla vigente de un marco (la última versión), o null si la empresa usa el flujo recomendado. */
export function currentTemplate(templates: FlowTemplateRow[], framework: LegalFramework): FlowTemplateRow | null {
  const own = templates.filter((t) => t.framework === framework);
  return own.length ? own[own.length - 1]! : null;
}

/** Reglas con que se gestiona una denuncia: la versión con que partió, o el flujo recomendado. */
export function rulesOf(templates: FlowTemplateRow[], templateId: string | null) {
  const t = templateId ? templates.find((x) => x.id === templateId) : undefined;
  return { config: t?.config ?? DEFAULT_FLOW, version: t?.version ?? null };
}

/**
 * Deja registrada en una denuncia recién creada (o reclasificada) la versión vigente del flujo de su marco,
 * y su plazo general según esa versión.
 */
export async function stampFlow(db: pg.Pool | pg.PoolClient, caseId: string, framework: LegalFramework, receivedAt: Date) {
  if (framework === "ley_karin") {
    await db.query("UPDATE cases SET flow_template_id = NULL WHERE id = $1", [caseId]);
    return;
  }
  const current = currentTemplate(await listTemplates(db), framework);
  const config = current?.config ?? DEFAULT_FLOW;
  await db.query("UPDATE cases SET flow_template_id = $2, due_at = $3 WHERE id = $1", [
    caseId,
    current?.id ?? null,
    addDays(receivedAt, config.closureDays, config.dayKind),
  ]);
}

/* ------------------------------------------------------------------ Edición (client_admin) */

const stepSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9]{4,16}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  title: z.string().trim().min(3, "Mínimo 3 caracteres").max(120, "Máximo 120 caracteres"),
  description: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres")
    .nullable()
    .optional()
    .transform((v) => v || null),
  days: z.number().int().min(0, "Mínimo 0 días").max(365, "Máximo 365 días").nullable(),
  dayKind: z.enum(["calendar", "business"]),
  required: z.boolean(),
  owner: z.enum(["case_manager", "investigator"]),
});

export const flowConfigSchema = z
  .object({
    ackDays: z.number().int().min(1, "Mínimo 1 día").max(30, "Máximo 30 días"),
    closureDays: z.number().int().min(15, "Mínimo 15 días").max(365, "Máximo 365 días"),
    dayKind: z.enum(["calendar", "business"]),
    steps: z.array(stepSchema).max(15, "Máximo 15 pasos propios"),
  })
  .superRefine((v, ctx) => {
    if (v.ackDays >= v.closureDays) {
      ctx.addIssue({ code: "custom", path: ["ackDays"], message: "El acuse debe ser antes del cierre" });
    }
    const titles = new Set<string>();
    v.steps.forEach((s, i) => {
      const t = s.title.toLowerCase();
      if (titles.has(t)) ctx.addIssue({ code: "custom", path: ["steps", i, "title"], message: "Hay otro paso con este nombre" });
      titles.add(t);
    });
  });

export const LAW_STEPS: Record<FlowFramework, { label: string; detail: string }[]> = {
  ley_20393: [
    {
      label: "Evaluar denuncia al Ministerio Público",
      detail: "Si hay antecedentes de delito (la autodenuncia es atenuante). Ley 20.393, modificada por Ley 21.595.",
    },
  ],
  ley_21719: [
    {
      label: "Evaluar si hubo una vulneración de seguridad de datos personales",
      detail: "Sin demora (referencia: 72 horas). Ley 21.719, art. 14 sexies.",
    },
    {
      label: "Reportar la vulneración a la Agencia de Protección de Datos",
      detail: "Sin dilaciones indebidas, si hubo vulneración.",
    },
    { label: "Comunicar a los titulares afectados", detail: "Si involucra datos sensibles, de menores o financieros." },
  ],
  internal: [],
};

/** Plantillas vigentes, historial de versiones y cuántas denuncias abiertas usa cada una (pantalla del client_admin). */
export async function getFlowsOverview(tenant: Tenant) {
  const pool = tenantPool(tenant);
  const [templates, users, usage] = await Promise.all([
    listTemplates(pool),
    pool.query<{ id: string; name: string }>("SELECT id, name FROM users"),
    pool.query<{ flow_template_id: string | null; framework: string; open: string }>(
      `SELECT c.flow_template_id, cat.legal_framework AS framework, count(*) AS open
       FROM cases c JOIN categories cat ON cat.id = c.category_id
       WHERE c.status <> 'closed' GROUP BY 1, 2`,
    ),
  ]);
  const nameOf = (id: string | null) => users.rows.find((u) => u.id === id)?.name ?? null;
  const openWith = (framework: string, templateId: string | null) =>
    Number(usage.rows.find((u) => u.framework === framework && u.flow_template_id === templateId)?.open ?? 0);

  return {
    flows: FLOW_FRAMEWORKS.map((framework) => {
      const current = currentTemplate(templates, framework);
      return {
        framework,
        version: current?.version ?? null,
        config: current?.config ?? DEFAULT_FLOW,
        updatedAt: current?.created_at ?? null,
        updatedBy: nameOf(current?.created_by ?? null),
        lawSteps: LAW_STEPS[framework],
        history: [
          ...templates
            .filter((t) => t.framework === framework)
            .reverse()
            .map((t) => ({
              version: t.version,
              note: t.note,
              createdAt: t.created_at,
              createdBy: nameOf(t.created_by),
              openCases: openWith(framework, t.id),
            })),
          // El flujo recomendado es la «versión 0»: la que usan las denuncias creadas antes de cualquier cambio.
          { version: 0, note: "Flujo recomendado de la plataforma", createdAt: null, createdBy: null, openCases: openWith(framework, null) },
        ],
      };
    }),
    defaultConfig: DEFAULT_FLOW,
  };
}

/** Guarda una versión nueva de la plantilla. Los pasos conservan su identificador para que el historial sea legible. */
export async function saveTemplate(tenant: Tenant, framework: FlowFramework, input: z.infer<typeof flowConfigSchema>, note: string | null, userId: string) {
  const config: FlowConfig = {
    ackDays: input.ackDays,
    closureDays: input.closureDays,
    dayKind: input.dayKind,
    steps: input.steps.map((s) => ({ ...s, key: s.key ?? randomBytes(4).toString("hex") })),
  };
  const keys = new Set<string>();
  for (const s of config.steps) {
    if (keys.has(s.key)) throw new HttpError(400, "Hay pasos repetidos");
    keys.add(s.key);
  }
  const pool = tenantPool(tenant);
  const current = currentTemplate(await listTemplates(pool), framework);
  if (canonicalFlow(current?.config ?? DEFAULT_FLOW) === canonicalFlow(config)) {
    throw new HttpError(400, "No hay cambios que guardar.", "no_changes");
  }
  try {
    const res = await pool.query<{ version: number }>(
      `INSERT INTO flow_templates (framework, version, config, note, created_by)
       SELECT $1, COALESCE(max(version), 0) + 1, $2, $3, $4 FROM flow_templates WHERE framework = $1
       RETURNING version`,
      [framework, JSON.stringify(config), note, userId],
    );
    return res.rows[0]!.version;
  } catch (err) {
    // Dos personas guardando a la vez: la segunda debe ver primero lo que guardó la otra.
    if ((err as { code?: string }).code === "23505") {
      throw new HttpError(409, "Otra persona acaba de guardar cambios en este flujo. Recarga la página y vuelve a intentarlo.");
    }
    throw err;
  }
}
