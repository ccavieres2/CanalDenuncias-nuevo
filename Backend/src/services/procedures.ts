import { addBusinessDays, addCalendarDays } from "./calendar.js";
import type { LegalFramework } from "./channel.js";
import { DEFAULT_FLOW, type FlowConfig, type StepOwner, addDays, daysLabel } from "./flows.js";

/**
 * Procedimiento legal de cada denuncia: hitos, plazos y fundamento normativo según su marco legal.
 *
 * Ley Karin (Ley 21.643, arts. 211-A y ss. del Código del Trabajo, y DS 21/2024):
 *   - Recibida la denuncia: medidas de resguardo inmediatas y derivación al organismo administrador de la Ley 16.744.
 *   - Dentro de 3 días hábiles: la empresa decide investigar internamente (y avisa a la DT del inicio y las medidas)
 *     o deriva la denuncia a la DT. Si el denunciante lo pide, debe derivarla.
 *   - Investigación interna: 30 días hábiles desde la recepción. El informe se envía a la DT dentro de 2 días hábiles;
 *     la DT tiene 30 días hábiles para pronunciarse (si no lo hace, las conclusiones se consideran válidas).
 *   - Medidas y sanciones: 15 días corridos desde el pronunciamiento (o desde que vence el plazo de la DT), informando
 *     al denunciante y al denunciado. Igual cuando investiga la DT, desde que se recibe su informe.
 *   - Subcontratación: la empresa que recibe informa a la otra (principal, contratista o usuaria) en 3 días hábiles.
 *   - Denuncia ante la DT: la DT notifica a la empresa y le pide medidas de resguardo, que se adoptan de inmediato.
 * Ley 20.393 / 21.595 y normativa interna: sin plazos legales para la investigación; se aplican las buenas prácticas
 * de ISO 37002 (acuse en 7 días y respuesta en 3 meses).
 * Ley 21.719: vulneraciones de seguridad de datos se reportan a la Agencia «sin dilaciones indebidas».
 *
 * Fuera de Ley Karin, la empresa puede ajustar los plazos de referencia y agregar pasos propios (flows.ts); el gestor
 * puede agregar tareas a un caso y extender plazos que no son legales, siempre con motivo.
 */

export type Origin =
  | "portal"
  | "direct"
  | "other_company"
  | "internal"
  | "dt"
  | "court"
  | "agency"
  | "prosecutor"
  | "other_authority";

/** Orígenes en que hay un denunciante a quien acusar recibo y responder. */
export const REPORTER_ORIGINS: Origin[] = ["portal", "direct", "other_company"];

/** Qué hay que responder a la autoridad que notificó la denuncia (con el plazo que ella fija). */
const AUTHORITY_RESPONSE: Partial<Record<Origin, string>> = {
  court: "Responder al tribunal (contestación o informe)",
  agency: "Responder a la Agencia de Protección de Datos Personales",
  prosecutor: "Responder al requerimiento del Ministerio Público",
  other_authority: "Responder a la autoridad",
};
export type Route = "internal" | "dt";
export type CompanyRelation = "same" | "contractor" | "principal" | "third_party";

export interface ProcedureCase {
  status: string;
  received_at: Date;
  origin: Origin;
  route: Route | null;
  company_relation: CompanyRelation | null;
  reporter_requests_dt: boolean;
  acknowledged_at: Date | null;
  measures_at: Date | null;
  authority_notified_at: Date | null;
  report_approved_at: Date | null;
  closed_at: Date | null;
  external_due_at: Date | null;
}

export interface MilestoneRecord {
  key: string;
  done_at: Date;
  result: string | null;
  detail: string | null;
}

export interface Milestone {
  key: string;
  label: string;
  /** Plazo expresado en palabras. */
  detail: string;
  /** Norma o criterio que lo establece. */
  basis: string;
  /** null = depende de un paso anterior que aún no ocurre. */
  dueAt: Date | null;
  done: boolean;
  doneAt: Date | null;
  result: string | null;
  note: string | null;
  /** El gestor lo registra con la acción «Registrar hito» (los demás se cumplen con otras acciones del flujo). */
  registrable: boolean;
  /** Lo hace un tercero (la Dirección del Trabajo): la empresa espera y registra cuando ocurre. */
  external: boolean;
  /** No siempre aplica (se muestra, pero no bloquea). */
  optional: boolean;
  /** Si es un plazo fijado por ley (true) o una buena práctica de referencia (false). */
  legal: boolean;
  /** De dónde viene: la ley, una buena práctica, el flujo de la empresa o una tarea del gestor en este caso. */
  source: "law" | "reference" | "company" | "task";
  /** Quién lo registra (pasos de la empresa y tareas). null = el gestor, como los hitos legales. */
  owner: StepOwner | null;
  /** Paso obligatorio del flujo de la empresa: sin él no se puede aprobar el cierre. */
  required: boolean;
  /** Plazo extendido por el gestor (solo plazos que no son legales). */
  extension: { previousDueAt: Date | null; reason: string; at: Date } | null;
}

export interface CaseTask {
  id: string;
  title: string;
  detail: string | null;
  assignee: StepOwner;
  due_at: Date | null;
}

export interface DeadlineExtension {
  milestone_key: string;
  previous_due_at: Date | null;
  new_due_at: Date;
  reason: string;
  created_at: Date;
}

/** Reglas propias de la empresa y del caso, además de lo que fija la ley. */
export interface CaseFlow {
  config: FlowConfig;
  /** Versión del flujo de la empresa (null = flujo recomendado). */
  version: number | null;
  tasks: CaseTask[];
  /** Última extensión de cada plazo. */
  extensions: Map<string, DeadlineExtension>;
}

export const DEFAULT_CASE_FLOW: CaseFlow = { config: DEFAULT_FLOW, version: null, tasks: [], extensions: new Map() };

/** Solo se pueden extender los plazos que no fija la ley ni dependen de un tercero. */
export const isExtendable = (m: Milestone) => !m.legal && !m.external && !m.done && m.dueAt !== null;

/** Resultados posibles al registrar ciertos hitos. */
export const MILESTONE_RESULTS: Record<string, string[]> = {
  dt_ruling: ["without_observations", "with_observations", "no_ruling"],
  breach_assessment: ["breach", "no_breach"],
};

export const RELATION_LABEL: Record<CompanyRelation, string> = {
  same: "Todas las personas son de la empresa",
  contractor: "Involucra a personal de una contratista o subcontratista",
  principal: "Involucra a personal de la empresa principal o usuaria",
  third_party: "El agresor es un tercero (cliente, proveedor o usuario)",
};

type Records = Map<string, MilestoneRecord>;

function base(key: string, label: string, detail: string, basis: string, dueAt: Date | null, records: Records, closed: boolean) {
  const r = records.get(key);
  return {
    key,
    label,
    detail,
    basis,
    dueAt,
    done: closed || !!r,
    doneAt: r?.done_at ?? null,
    result: r?.result ?? null,
    note: r?.detail ?? null,
    registrable: true,
    external: false,
    optional: false,
    legal: true,
    source: "law",
    owner: null,
    required: false,
    extension: null,
  } satisfies Milestone;
}

function karin(c: ProcedureCase, records: Records): Milestone[] {
  const closed = c.status === "closed";
  const recv = c.received_at;
  const fromDt = c.origin === "dt";
  // «Inmediato»: se exige el mismo día en que se recibe (o notifica) la denuncia.
  const today = addCalendarDays(recv, 0);
  const out: Milestone[] = [];

  out.push({
    ...base(
      "measures",
      "Medidas de resguardo",
      fromDt ? "Inmediatas al ser notificada por la DT" : "Inmediatas al recibir la denuncia",
      "Art. 211-B Código del Trabajo",
      today,
      records,
      closed,
    ),
    done: closed || c.measures_at !== null,
    doneAt: c.measures_at,
    registrable: false,
  });
  out.push(
    base(
      "oal_referral",
      "Derivación al organismo administrador (Ley 16.744)",
      "Inmediata: atención psicológica temprana para la persona afectada",
      "Art. 211-B Código del Trabajo",
      today,
      records,
      closed,
    ),
  );
  if (c.company_relation === "contractor" || c.company_relation === "principal") {
    out.push(
      base(
        "other_employer_notice",
        c.company_relation === "contractor" ? "Informar a la empresa contratista" : "Informar a la empresa principal o usuaria",
        "3 días hábiles desde la recepción",
        "DS 21/2024 (régimen de subcontratación)",
        addBusinessDays(recv, 3),
        records,
        closed,
      ),
    );
  }

  if (!fromDt && !c.route) {
    out.push({
      ...base(
        "route_decision",
        c.reporter_requests_dt ? "Derivar a la DT (lo pidió el denunciante)" : "Decidir quién investiga: la empresa o la DT",
        "3 días hábiles desde la recepción",
        "Art. 211-C Código del Trabajo",
        addBusinessDays(recv, 3),
        records,
        closed,
      ),
      registrable: false,
    });
  }

  if (c.route === "internal") {
    out.push(
      base(
        "dt_start_notice",
        "Aviso a la DT del inicio de la investigación y medidas adoptadas",
        "3 días hábiles desde la recepción",
        "Art. 12 DS 21/2024",
        addBusinessDays(recv, 3),
        records,
        closed,
      ),
    );
    out.push({
      ...base(
        "investigation",
        "Término de la investigación (informe final aprobado)",
        "30 días hábiles desde la recepción",
        "Art. 211-C Código del Trabajo; DS 21/2024",
        addBusinessDays(recv, 30),
        records,
        closed,
      ),
      done: closed || c.report_approved_at !== null,
      doneAt: c.report_approved_at,
      registrable: false,
    });
    out.push({
      ...base(
        "dt_report",
        "Envío del informe final a la DT (depósito de la investigación)",
        "2 días hábiles desde el término de la investigación",
        "DS 21/2024",
        c.report_approved_at ? addBusinessDays(c.report_approved_at, 2) : null,
        records,
        closed,
      ),
      // Se envía una vez aprobado el informe final.
      registrable: c.report_approved_at !== null,
    });
    const sent = records.get("dt_report")?.done_at ?? null;
    out.push({
      ...base(
        "dt_ruling",
        "Pronunciamiento de la DT sobre el informe",
        "La DT tiene 30 días hábiles; si no se pronuncia, las conclusiones se consideran válidas",
        "Art. 211-C Código del Trabajo",
        sent ? addBusinessDays(sent, 30) : null,
        records,
        closed,
      ),
      external: true,
      registrable: sent !== null,
    });
    const ruling = records.get("dt_ruling")?.done_at ?? (sent ? addBusinessDays(sent, 30) : null);
    out.push({
      ...base(
        "measures_applied",
        "Aplicar medidas y sanciones e informar a denunciante y denunciado",
        "15 días corridos desde el pronunciamiento de la DT (o desde que venció su plazo)",
        "Art. 211-C Código del Trabajo; DS 21/2024",
        ruling ? addCalendarDays(ruling, 15) : null,
        records,
        closed,
      ),
      // Primero se registra el pronunciamiento (o que venció el plazo sin él).
      registrable: records.has("dt_ruling"),
    });
  }

  if (c.route === "dt") {
    if (!fromDt) {
      out.push(
        base(
          "dt_referral",
          "Derivación de la denuncia y sus antecedentes a la DT",
          "3 días hábiles desde la recepción",
          "Art. 211-C Código del Trabajo; DS 21/2024",
          addBusinessDays(recv, 3),
          records,
          closed,
        ),
      );
    }
    const start = fromDt ? recv : (records.get("dt_referral")?.done_at ?? null);
    out.push({
      ...base(
        "dt_result",
        "Informe de la investigación de la DT",
        fromDt ? "La DT investiga en 30 días hábiles (referencial, desde la notificación)" : "La DT investiga en 30 días hábiles desde la derivación",
        "DS 21/2024",
        start ? addBusinessDays(start, 30) : null,
        records,
        closed,
      ),
      external: true,
      registrable: start !== null,
    });
    const result = records.get("dt_result")?.done_at ?? null;
    out.push({
      ...base(
        "measures_applied",
        "Aplicar medidas y sanciones e informar a denunciante y denunciado",
        "15 días corridos desde que se recibe el informe de la DT",
        "Art. 211-C Código del Trabajo",
        result ? addCalendarDays(result, 15) : null,
        records,
        closed,
      ),
      registrable: result !== null,
    });
  }
  return out;
}

/** Respuesta a la autoridad que notificó la denuncia, con el plazo que ella fijó. */
function authorityResponse(c: ProcedureCase, records: Records): Milestone[] {
  const label = AUTHORITY_RESPONSE[c.origin];
  if (!label || !c.external_due_at) return [];
  return [
    base(
      "authority_response",
      label,
      "Plazo fijado por la autoridad al notificar",
      "Requerimiento de la autoridad",
      addCalendarDays(c.external_due_at, 0),
      records,
      c.status === "closed",
    ),
  ];
}

/** Acuse y respuesta al denunciante (ISO 37002; en la UE, Directiva 2019/1937), con los plazos del flujo de la empresa. */
function isoMilestones(c: ProcedureCase, records: Records, flow: CaseFlow): Milestone[] {
  const closed = c.status === "closed";
  const { ackDays, closureDays, dayKind } = flow.config;
  const custom = flow.version !== null;
  const basis = custom ? `Flujo de la empresa (versión ${flow.version})` : "Buena práctica ISO 37002";
  const reference = { registrable: false, legal: false, source: (custom ? "company" : "reference") as Milestone["source"] };
  const closure = addDays(c.received_at, closureDays, dayKind);
  // Sin denunciante (detectada internamente o notificada por una autoridad): solo se fija un cierre de referencia.
  if (!REPORTER_ORIGINS.includes(c.origin)) {
    return [
      {
        ...base("closure", "Concluir la investigación", `${daysLabel(closureDays, dayKind)} desde la recepción`, basis, closure, records, closed),
        ...reference,
      },
    ];
  }
  return [
    {
      ...base(
        "ack",
        "Acuse de recibo al denunciante",
        `${daysLabel(ackDays, dayKind)} desde la recepción`,
        basis,
        addDays(c.received_at, ackDays, dayKind),
        records,
        closed,
      ),
      done: closed || c.acknowledged_at !== null,
      doneAt: c.acknowledged_at,
      ...reference,
    },
    {
      ...base("feedback", "Respuesta al denunciante y cierre", `${daysLabel(closureDays, dayKind)} desde la recepción`, basis, closure, records, closed),
      ...reference,
    },
  ];
}

/** Pasos propios del flujo de la empresa y tareas que el gestor agregó a este caso. */
function companyMilestones(c: ProcedureCase, records: Records, flow: CaseFlow): Milestone[] {
  const closed = c.status === "closed";
  const steps: Milestone[] = flow.config.steps.map((st) => ({
    ...base(
      `step:${st.key}`,
      st.title,
      st.days === null ? (st.description ?? "Sin plazo fijo") : `${daysLabel(st.days, st.dayKind)} desde la recepción`,
      `Flujo de la empresa (versión ${flow.version})`,
      st.days === null ? null : addDays(c.received_at, st.days, st.dayKind),
      records,
      closed,
    ),
    legal: false,
    optional: !st.required,
    required: st.required,
    source: "company",
    owner: st.owner,
  }));
  const tasks: Milestone[] = flow.tasks.map((t) => ({
    ...base(`task:${t.id}`, t.title, t.detail ?? "Tarea agregada por el gestor", "Tarea de este caso", t.due_at, records, closed),
    legal: false,
    source: "task",
    owner: t.assignee,
  }));
  return [...steps, ...tasks];
}

/** Aplica las extensiones de plazo registradas (solo a plazos que no son legales). */
function withExtensions(milestones: Milestone[], flow: CaseFlow): Milestone[] {
  return milestones.map((m) => {
    const ext = flow.extensions.get(m.key);
    if (!ext || m.legal || m.external) return m;
    return {
      ...m,
      dueAt: ext.new_due_at,
      extension: { previousDueAt: ext.previous_due_at, reason: ext.reason, at: ext.created_at },
    };
  });
}

export function procedureFor(
  framework: LegalFramework,
  c: ProcedureCase,
  records: Records,
  flow: CaseFlow = DEFAULT_CASE_FLOW,
): Milestone[] {
  // Ley Karin: la ley fija el procedimiento; el gestor solo puede agregar tareas propias al caso.
  if (framework === "ley_karin") {
    const tasks = companyMilestones(c, records, { ...flow, config: { ...flow.config, steps: [] } });
    return withExtensions([...authorityResponse(c, records), ...karin(c, records), ...tasks], flow);
  }
  return withExtensions([...authorityResponse(c, records), ...frameworkMilestones(framework, c, records, flow)], flow);
}

function frameworkMilestones(framework: LegalFramework, c: ProcedureCase, records: Records, flow: CaseFlow): Milestone[] {
  const closed = c.status === "closed";
  const iso = isoMilestones(c, records, flow);
  const withReporter = iso.length === 2;
  const ack = withReporter ? iso[0] : undefined;
  const feedback = withReporter ? iso[1] : iso[0];
  // Los pasos propios y las tareas van antes de la respuesta final y el cierre.
  const own = companyMilestones(c, records, flow);

  if (framework === "ley_20393") {
    return [
      ...(ack ? [ack] : []),
      {
        ...base(
          "prosecutor",
          "Evaluar denuncia al Ministerio Público",
          "Si hay antecedentes de delito (la autodenuncia es atenuante)",
          "Ley 20.393, modificada por Ley 21.595",
          null,
          records,
          closed,
        ),
        done: closed || c.authority_notified_at !== null || records.has("prosecutor"),
        optional: true,
      },
      ...own,
      feedback!,
    ];
  }

  if (framework === "ley_21719") {
    const assessment = records.get("breach_assessment");
    const out: Milestone[] = [
      ...(ack ? [ack] : []),
      {
        ...base(
          "breach_assessment",
          "Evaluar si hubo una vulneración de seguridad de datos personales",
          "Sin demora (referencia: 72 horas desde la recepción)",
          "Ley 21.719, art. 14 sexies",
          new Date(c.received_at.getTime() + 72 * 3_600_000),
          records,
          closed,
        ),
        legal: false,
      },
    ];
    if (assessment?.result === "breach") {
      out.push({
        ...base(
          "agency_notice",
          "Reportar la vulneración a la Agencia de Protección de Datos Personales",
          "Sin dilaciones indebidas (referencia: 72 horas desde la evaluación)",
          "Ley 21.719, art. 14 sexies",
          new Date(assessment.done_at.getTime() + 72 * 3_600_000),
          records,
          closed,
        ),
      });
      out.push({
        ...base(
          "holders_notice",
          "Comunicar a los titulares afectados",
          "Obligatorio si involucra datos sensibles, de niños, niñas y adolescentes o financieros",
          "Ley 21.719, art. 14 sexies",
          null,
          records,
          closed,
        ),
        optional: true,
      });
    }
    out.push(...own, feedback!);
    return out;
  }

  return [...(ack ? [ack] : []), ...own, feedback!];
}

/** Próximo vencimiento a cargo de la empresa (lo que muestra la bandeja en «Plazo»). */
export function nextDue(milestones: Milestone[]): Date | null {
  const pending = milestones.filter((m) => !m.done && !m.external && !m.optional && m.dueAt).map((m) => m.dueAt!.getTime());
  return pending.length ? new Date(Math.min(...pending)) : null;
}
