import type { LegalFramework, TenantRole } from "./roles";

export type CaseStatus =
  | "received"
  | "in_review"
  | "investigating"
  | "resolution"
  | "follow_up"
  | "closed";
export type CaseOrigin =
  | "portal"
  | "direct"
  | "other_company"
  | "internal"
  | "dt"
  | "court"
  | "agency"
  | "prosecutor"
  | "other_authority";
export type OriginChannel =
  "verbal" | "letter" | "email" | "phone" | "intermediary";
export type KarinRoute = "internal" | "dt";
export type CompanyRelation =
  "same" | "contractor" | "principal" | "third_party";
export type CaseRole = Exclude<TenantRole, "client_admin">;

export interface CaseSummary {
  id: string;
  code: string;
  status: CaseStatus;
  category: { id: string; name: string; framework: LegalFramework };
  subject: string;
  receivedAt: string;
  dueAt: string | null;
  closedAt: string | null;
  isAnonymous: boolean;
  investigator: { id: string; name: string } | null;
  origin: CaseOrigin;
  route: KarinRoute | null;
  /** La persona pidió medidas de protección urgentes y el caso sigue abierto. */
  urgentProtection: boolean;
  isDemo: boolean;
  unreadMessages: number;
}

export interface CasePermissions {
  viewContent: boolean;
  assign: boolean;
  measures: boolean;
  diligence: boolean;
  message: boolean;
  propose: boolean;
  approve: boolean;
}

export type CaseAction =
  | "start_review"
  | "reclassify"
  | "involve"
  | "assign"
  | "measure"
  | "authority"
  | "note"
  | "diligence"
  | "propose"
  | "dismiss"
  | "approve"
  | "reject"
  | "message"
  | "set_route"
  | "milestone"
  | "add_task"
  | "extend_deadline";

export type Finding =
  "substantiated" | "partially" | "unsubstantiated" | "inadmissible";

export const FINDINGS: Record<Finding, { label: string; styles: string }> = {
  substantiated: {
    label: "Hechos acreditados",
    styles: "bg-red-50 text-red-700 ring-red-600/15",
  },
  partially: {
    label: "Hechos parcialmente acreditados",
    styles: "bg-amber-50 text-amber-800 ring-amber-600/20",
  },
  unsubstantiated: {
    label: "Hechos no acreditados",
    styles: "bg-gray-100 text-gray-700 ring-gray-500/15",
  },
  inadmissible: {
    label: "Denuncia desestimada",
    styles: "bg-gray-100 text-gray-700 ring-gray-500/15",
  },
};

export interface CaseDetail extends CaseSummary {
  description: string | null;
  reporter: {
    name: string | null;
    email: string | null;
    phone: string | null;
    rut: string | null;
  } | null;
  /** Persona afectada, cuando denunció un tercero en su representación. */
  affected: {
    name: string | null;
    rut: string | null;
    email: string | null;
    representation: string | null;
  } | null;
  originChannel: OriginChannel | null;
  externalDueAt: string | null;
  reporterRelation: string | null;
  occurredWhen: string | null;
  occurredWhere: string | null;
  involved: { name: string; relation: string }[];
  involvedUsers: { id: string; name: string }[];
  finding: Finding | null;
  proposal: string | null;
  proposedAt: string | null;
  proposedBy: string | null;
  outcome: string | null;
  resolvedBy: string | null;
  authorityNotifiedAt: string | null;
  originDetail: string | null;
  /** Lo que contó la persona al elegir «Otro». */
  topicDetail: string | null;
  offenderRelation: OffenderRelation | null;
  ongoing: "yes" | "no" | "unknown" | null;
  reporterChannel: boolean;
  reporterRequestsDt: boolean;
  companyRelation: CompanyRelation | null;
  companyRelationLabel: string | null;
  otherCompany: string | null;
  reportApprovedAt: string | null;
  /** Procedimiento legal: hitos con plazo y fundamento. */
  deadlines: Milestone[];
  /** Versión del flujo de la empresa con que se gestiona (null = recomendado). */
  flowVersion: number | null;
  permissions: CasePermissions;
  /** Acciones disponibles ahora para el rol activo (según estado y modalidad). */
  actions: CaseAction[];
  approveBlockedReason?: string;
}

export interface Milestone {
  key: string;
  label: string;
  detail: string;
  basis: string;
  dueAt: string | null;
  done: boolean;
  doneAt: string | null;
  result: string | null;
  note: string | null;
  registrable: boolean;
  external: boolean;
  optional: boolean;
  legal: boolean;
  /** De dónde viene: la ley, una buena práctica, el flujo de la empresa o una tarea del gestor. */
  source: "law" | "reference" | "company" | "task";
  /** Quién lo registra (pasos de la empresa y tareas). */
  owner: "case_manager" | "investigator" | null;
  /** Paso obligatorio del flujo de la empresa (bloquea el cierre). */
  required: boolean;
  /** Plazo extendido por el gestor, con su motivo. */
  extension: { previousDueAt: string | null; reason: string; at: string } | null;
  /** El rol activo puede registrarlo o extender su plazo ahora. */
  canRegister: boolean;
  canExtend: boolean;
}

export const MILESTONE_RESULT_LABEL: Record<string, string> = {
  without_observations: "Sin observaciones",
  with_observations: "Con observaciones",
  no_ruling: "Venció el plazo sin pronunciamiento",
  breach: "Hubo vulneración de seguridad",
  no_breach: "No hubo vulneración",
};

export const ORIGIN_LABEL: Record<CaseOrigin, string> = {
  portal: "Portal de denuncias",
  direct: "Recibida directamente",
  other_company: "Remitida por otra empresa",
  internal: "Detectada internamente",
  dt: "Notificada por la DT",
  court: "Notificada por un tribunal",
  agency: "Notificada por la Agencia de Datos",
  prosecutor: "Ministerio Público o policías",
  other_authority: "Notificada por una autoridad",
};

export const CHANNEL_LABEL: Record<OriginChannel, string> = {
  verbal: "Verbal, con acta firmada",
  letter: "Por escrito (carta o buzón físico)",
  email: "Por correo electrónico",
  phone: "Por teléfono",
  intermediary: "A través de jefatura, sindicato o comité paritario",
};

export const ROUTE_LABEL: Record<KarinRoute, string> = {
  internal: "Investigación interna",
  dt: "Investiga la Dirección del Trabajo",
};

export type OffenderRelation =
  "superior" | "peer" | "subordinate" | "third_party" | "other_company";

export const OFFENDER_LABEL: Record<OffenderRelation, string> = {
  superior: "Una jefatura o superior",
  peer: "Un compañero o compañera",
  subordinate: "Una persona a su cargo",
  third_party: "Un cliente, proveedor o usuario",
  other_company: "Alguien de otra empresa (contratista)",
};

export const ONGOING_LABEL = {
  yes: "Sigue ocurriendo",
  no: "Ya no ocurre",
  unknown: "No sabe si sigue ocurriendo",
} as const;

export const RELATION_OPTIONS: {
  value: CompanyRelation;
  label: string;
  hint: string;
}[] = [
  {
    value: "same",
    label: "Todas las personas son de la empresa",
    hint: "Denunciante y denunciado trabajan aquí.",
  },
  {
    value: "contractor",
    label: "Involucra a personal de una contratista",
    hint: "Hay que informar a la contratista o subcontratista dentro de 3 días hábiles.",
  },
  {
    value: "principal",
    label: "Involucra a la empresa principal o usuaria",
    hint: "Somos contratista o de servicios transitorios: hay que informar a la principal o usuaria dentro de 3 días hábiles.",
  },
  {
    value: "third_party",
    label: "El agresor es un tercero",
    hint: "Cliente, proveedor o usuario: violencia en el trabajo ejercida por terceros.",
  },
];

export interface CaseEvent {
  occurred_at: string;
  actor_label: string;
  action: string;
  detail: string | null;
  kind: string;
}

export interface CaseMessage {
  id: string;
  sender: "reporter" | "staff";
  author: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface CaseOptions {
  investigators: { id: string; name: string; area: string | null }[];
  categories: { id: string; name: string; framework: LegalFramework }[];
  users: { id: string; name: string; area: string | null }[];
  milestoneResults: Record<string, string[]>;
}

export interface CaseResponse {
  case: CaseDetail;
  events: CaseEvent[];
  messages: CaseMessage[];
  options: CaseOptions | null;
}

export const STATUS: Record<
  CaseStatus,
  { label: string; styles: string; dot: string }
> = {
  received: {
    label: "Recibida",
    styles: "bg-sky-50 text-sky-700 ring-sky-600/15",
    dot: "bg-sky-500",
  },
  in_review: {
    label: "En revisión",
    styles: "bg-indigo-50 text-indigo-700 ring-indigo-600/15",
    dot: "bg-indigo-500",
  },
  investigating: {
    label: "En investigación",
    styles: "bg-violet-50 text-violet-700 ring-violet-600/15",
    dot: "bg-violet-500",
  },
  resolution: {
    label: "Por resolver",
    styles: "bg-amber-50 text-amber-800 ring-amber-600/20",
    dot: "bg-amber-500",
  },
  follow_up: {
    label: "En seguimiento",
    styles: "bg-teal-50 text-teal-700 ring-teal-600/15",
    dot: "bg-teal-500",
  },
  closed: {
    label: "Cerrada",
    styles: "bg-gray-100 text-gray-700 ring-gray-500/15",
    dot: "bg-gray-400",
  },
};

export const STATUS_ORDER: CaseStatus[] = [
  "received",
  "in_review",
  "investigating",
  "resolution",
  "follow_up",
  "closed",
];

/** Cómo se llama la bandeja y qué muestra según el rol activo. */
export const CASE_VIEW: Record<
  CaseRole,
  { menu: string; title: string; description: string }
> = {
  case_manager: {
    menu: "Bandeja de denuncias",
    title: "Bandeja de denuncias",
    description:
      "Todas las denuncias de tus categorías. Clasifícalas, revisa conflictos de interés y asigna al investigador.",
  },
  investigator: {
    menu: "Mis investigaciones",
    title: "Mis investigaciones",
    description: "Denuncias que tienes asignadas para investigar.",
  },
  resolver: {
    menu: "Por resolver",
    title: "Denuncias por resolver",
    description:
      "Casos cuya conclusión espera tu aprobación y los que ya fueron resueltos.",
  },
  auditor: {
    menu: "Revisión de denuncias",
    title: "Revisión de denuncias",
    description:
      "Todas las denuncias en modo solo lectura: estados, plazos y trazabilidad, sin contenido ni identidades.",
  },
};

/** Lo que puede hacer cada rol (resumen para el inicio). */
export const ROLE_CAPABILITIES: Record<CaseRole, string[]> = {
  case_manager: [
    "Iniciar la revisión y enviar el acuse de recibo",
    "Reclasificar y asignar al investigador",
    "Registrar medidas de resguardo y avisos a la autoridad",
    "Ley Karin: decidir si investiga la empresa o la DT y registrar cada hito legal",
    "Registrar denuncias recibidas en persona o notificadas por la DT",
    "Escribir al denunciante",
    "Proponer desestimar denuncias sin fundamento",
  ],
  investigator: [
    "Registrar diligencias y entrevistas",
    "Registrar medidas de resguardo",
    "Escribir al denunciante",
    "Proponer la conclusión al comité",
  ],
  resolver: [
    "Revisar el informe del investigador",
    "Aprobar el cierre (en Ley Karin, el informe final) o devolverlo con observaciones",
  ],
  auditor: [
    "Revisar estados, plazos y trazabilidad (solo lectura)",
    "Revisar el registro de accesos",
  ],
};

const DAY = 86_400_000;

/** Semáforo de plazo de una denuncia. */
export function dueState(c: Pick<CaseSummary, "status" | "dueAt">): {
  label: string;
  tone: "ok" | "warn" | "late" | "done";
} {
  if (c.status === "closed") return { label: "Cerrada", tone: "done" };
  // Abierta sin plazos a cargo de la empresa (p. ej., esperando el pronunciamiento de la DT).
  if (!c.dueAt) return { label: "Sin plazos pendientes", tone: "done" };
  const days = daysUntil(c.dueAt);
  if (days < 0)
    return {
      label: `Vencida hace ${-days} ${-days === 1 ? "día" : "días"}`,
      tone: "late",
    };
  if (days <= 5)
    return {
      label:
        days === 0
          ? "Vence hoy"
          : `Vence en ${days} ${days === 1 ? "día" : "días"}`,
      tone: "warn",
    };
  return { label: `${days} días restantes`, tone: "ok" };
}

/** ¿El plazo ya pasó? */
export const isOverdue = (dueAt: string) =>
  new Date(dueAt).getTime() < Date.now();

export const DUE_STYLES = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  late: "text-red-700",
  done: "text-gray-500",
};

/** Días (redondeados hacia arriba) que faltan para una fecha; negativo si ya pasó. */
export function daysUntil(iso: string): number {
  // Por fecha calendario: un plazo que vence hoy a las 23:59 es «hoy», no «en 1 día».
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(new Date(iso)) - startOf(new Date())) / DAY);
}

/** Días corridos entre dos fechas. */
export const elapsedDays = (from: string, to: string) =>
  Math.max(
    0,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY),
  );
