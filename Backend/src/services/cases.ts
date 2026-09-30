import { randomBytes } from "node:crypto";
import type pg from "pg";
import QRCode from "qrcode";
import { z } from "zod";
import { HttpError } from "../errors.js";
import type { TenantRole } from "./auth.js";
import {
  type Category,
  type ChannelUser,
  type LegalFramework,
  effectiveCategories,
  getSettings,
  listCategories,
  listUsers,
} from "./channel.js";
import { addBusinessDays, addCalendarDays } from "./calendar.js";
import { type FlowTemplateRow, listTemplates, rulesOf, stampFlow } from "./flows.js";
import {
  type CaseFlow,
  type CaseTask,
  type CompanyRelation,
  type DeadlineExtension,
  MILESTONE_RESULTS,
  type Milestone,
  type MilestoneRecord,
  type Origin,
  RELATION_LABEL,
  REPORTER_ORIGINS,
  type Route,
  isExtendable,
  nextDue,
  procedureFor,
} from "./procedures.js";
import { normalizeRut } from "./rut.js";
import { decryptSecret, encryptSecret, sha256 } from "./secrets.js";
import { type Tenant, tenantPool } from "./tenants.js";
import { base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from "./totp.js";

/**
 * Denuncias. Qué ve cada rol (siempre excluyendo aquellas en que la persona está involucrada):
 * - Gestor: todas las de sus categorías.
 * - Investigador: solo las que tiene asignadas.
 * - Comité / Resolutor: las de sus categorías que llegaron a resolución o están cerradas.
 * - Auditor: todas, sin el relato ni datos que identifiquen a las personas.
 *
 * Flujo: recibida → en revisión (gestor) → en investigación (investigador asignado)
 *        → por resolver (conclusión propuesta o desestimación) → cerrada (comité aprueba).
 * En Ley Karin, tras aprobar el informe queda «en seguimiento» (informe a la DT, pronunciamiento y medidas), y si
 * investiga la Dirección del Trabajo la denuncia pasa directo a seguimiento hasta recibir su informe.
 */

export type CaseStatus = "received" | "in_review" | "investigating" | "resolution" | "follow_up" | "closed";
export type CaseRole = Exclude<TenantRole, "client_admin">;
export const CASE_ROLES: readonly CaseRole[] = ["case_manager", "investigator", "resolver", "auditor"];
export type Finding = "substantiated" | "partially" | "unsubstantiated" | "inadmissible";

const ROLE_LABEL: Record<CaseRole, string> = {
  case_manager: "Gestor",
  investigator: "Investigador",
  resolver: "Comité",
  auditor: "Auditor",
};

const FINDING_LABEL: Record<Finding, string> = {
  substantiated: "Hechos acreditados",
  partially: "Hechos parcialmente acreditados",
  unsubstantiated: "Hechos no acreditados",
  inadmissible: "Denuncia desestimada",
};

interface CaseRow {
  id: string;
  code: string;
  category_id: string;
  status: CaseStatus;
  subject: string;
  description: string;
  is_anonymous: boolean;
  reporter_name: string | null;
  reporter_email: string | null;
  reporter_phone: string | null;
  reporter_relation: string | null;
  occurred_when: string | null;
  occurred_where: string | null;
  involved: { name: string; relation: string }[];
  involved_user_ids: string[];
  investigator_id: string | null;
  received_at: Date;
  due_at: Date | null;
  closed_at: Date | null;
  outcome: string | null;
  acknowledged_at: Date | null;
  measures_at: Date | null;
  authority_notified_at: Date | null;
  finding: Finding | null;
  proposal: string | null;
  proposed_at: Date | null;
  proposed_by: string | null;
  resolved_by: string | null;
  tracking_key_hash: string | null;
  origin: Origin;
  origin_detail: string | null;
  route: Route | null;
  reporter_requests_dt: boolean;
  company_relation: CompanyRelation | null;
  other_company: string | null;
  report_approved_at: Date | null;
  origin_channel: string | null;
  external_due_at: Date | null;
  reporter_rut: string | null;
  reporter_is_affected: boolean;
  affected_name: string | null;
  affected_rut: string | null;
  affected_email: string | null;
  representation: string | null;
  totp_secret: string | null;
  totp_enabled_at: Date | null;
  topic_detail: string | null;
  offender_relation: OffenderRelation | null;
  ongoing: "yes" | "no" | "unknown" | null;
  urgent_protection: boolean;
  is_demo: boolean;
  /** Versión del flujo de la empresa con que partió (NULL = flujo recomendado). */
  flow_template_id: string | null;
}

/** Ley Karin: quién realizó la conducta respecto de la persona afectada. */
export type OffenderRelation = "superior" | "peer" | "subordinate" | "third_party" | "other_company";
const OFFENDER_RELATIONS = ["superior", "peer", "subordinate", "third_party", "other_company"] as const;

/** Qué puede hacer el rol en general (se muestra en la ficha aunque el estado actual no lo permita). */
export interface CasePermissions {
  viewContent: boolean;
  assign: boolean;
  measures: boolean;
  diligence: boolean;
  message: boolean;
  propose: boolean;
  approve: boolean;
}

const BASE_PERMISSIONS: Record<CaseRole, CasePermissions> = {
  case_manager: { viewContent: true, assign: true, measures: true, diligence: false, message: true, propose: false, approve: false },
  investigator: { viewContent: true, assign: false, measures: true, diligence: true, message: true, propose: true, approve: false },
  resolver: { viewContent: true, assign: false, measures: false, diligence: false, message: false, propose: false, approve: true },
  auditor: { viewContent: false, assign: false, measures: false, diligence: false, message: false, propose: false, approve: false },
};

/* ------------------------------------------------------------------ Plazos */

const formatChileDate = (d: Date) =>
  new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

export const caseDueDate = (framework: LegalFramework, receivedAt: Date) =>
  framework === "ley_karin" ? addBusinessDays(receivedAt, 30) : addCalendarDays(receivedAt, 90);

type RecordsByCase = Map<string, Map<string, MilestoneRecord>>;

async function loadMilestones(db: pg.Pool | pg.PoolClient, caseIds?: string[]): Promise<RecordsByCase> {
  const res = caseIds
    ? await db.query<MilestoneRecord & { case_id: string }>("SELECT * FROM case_milestones WHERE case_id = ANY($1)", [caseIds])
    : await db.query<MilestoneRecord & { case_id: string }>("SELECT * FROM case_milestones");
  const out: RecordsByCase = new Map();
  for (const r of res.rows) {
    if (!out.has(r.case_id)) out.set(r.case_id, new Map());
    out.get(r.case_id)!.set(r.key, r);
  }
  return out;
}

/** Tareas agregadas por el gestor y extensiones de plazo de cada caso. */
interface FlowData {
  tasks: Map<string, CaseTask[]>;
  extensions: Map<string, Map<string, DeadlineExtension>>;
}

async function loadFlowData(db: pg.Pool | pg.PoolClient, caseIds?: string[]): Promise<FlowData> {
  const filter = caseIds ? "WHERE case_id = ANY($1)" : "";
  const params = caseIds ? [caseIds] : [];
  const [tasks, extensions] = await Promise.all([
    db.query<CaseTask & { case_id: string }>(`SELECT * FROM case_tasks ${filter} ORDER BY created_at`, params),
    db.query<DeadlineExtension & { case_id: string }>(`SELECT * FROM case_deadline_extensions ${filter} ORDER BY created_at`, params),
  ]);
  const out: FlowData = { tasks: new Map(), extensions: new Map() };
  for (const t of tasks.rows) out.tasks.set(t.case_id, [...(out.tasks.get(t.case_id) ?? []), t]);
  // Ordenadas por fecha: la última extensión de cada plazo es la que rige.
  for (const e of extensions.rows) {
    if (!out.extensions.has(e.case_id)) out.extensions.set(e.case_id, new Map());
    out.extensions.get(e.case_id)!.set(e.milestone_key, e);
  }
  return out;
}

function flowOf(c: CaseRow, ctx: Ctx, data: FlowData): CaseFlow {
  return {
    ...rulesOf(ctx.templates, c.flow_template_id),
    tasks: data.tasks.get(c.id) ?? [],
    extensions: data.extensions.get(c.id) ?? new Map(),
  };
}

function milestonesOf(c: CaseRow, ctx: Ctx, records: RecordsByCase, data: FlowData): Milestone[] {
  const category = ctx.categories.find((x) => x.id === c.category_id)!;
  return procedureFor(category.legal_framework, c, records.get(c.id) ?? new Map(), flowOf(c, ctx, data));
}

/** Pasos obligatorios del flujo de la empresa que aún no se registran (bloquean el cierre). */
const pendingRequired = (milestones: Milestone[], owner?: "investigator") =>
  milestones.filter((m) => m.source === "company" && m.required && !m.done && (!owner || m.owner === owner));

/* ------------------------------------------------------------------ Visibilidad */

function canSee(role: CaseRole, me: ChannelUser, c: CaseRow, myCategoryIds: Set<string>): boolean {
  if (c.involved_user_ids.includes(me.id)) return false;
  switch (role) {
    case "case_manager":
      return myCategoryIds.has(c.category_id);
    case "investigator":
      return c.investigator_id === me.id;
    case "resolver":
      return ["resolution", "follow_up", "closed"].includes(c.status) && myCategoryIds.has(c.category_id);
    case "auditor":
      return true;
  }
}

async function loadContext(tenant: Tenant, userId: string) {
  const [users, categories, settings, templates] = await Promise.all([
    listUsers(tenant),
    listCategories(tenant),
    getSettings(tenant),
    listTemplates(tenantPool(tenant)),
  ]);
  const me = users.find((u) => u.id === userId);
  if (!me) throw new HttpError(401, "No autenticado");
  const myCategoryIds = new Set(effectiveCategories(me, categories).map((c) => c.id));
  return { users, categories, settings, me, myCategoryIds, templates: templates as FlowTemplateRow[] };
}

type Ctx = Awaited<ReturnType<typeof loadContext>>;

/* ------------------------------------------------------------------ Acciones disponibles */

export const CASE_ACTIONS = [
  "start_review",
  "reclassify",
  "involve",
  "assign",
  "measure",
  "authority",
  "note",
  "diligence",
  "propose",
  "dismiss",
  "approve",
  "reject",
  "message",
  "set_route",
  "milestone",
  "add_task",
  "extend_deadline",
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];

const frameworkOf = (c: CaseRow, ctx: Ctx) => ctx.categories.find((x) => x.id === c.category_id)?.legal_framework;

/** Acciones que el rol activo puede hacer ahora mismo, según el estado del caso, su marco legal y la modalidad. */
function availableActions(
  role: CaseRole,
  c: CaseRow,
  ctx: Ctx,
  milestones: Milestone[],
): { actions: CaseAction[]; approveBlockedReason?: string } {
  const open = c.status !== "closed";
  const karin = frameworkOf(c, ctx) === "ley_karin";
  const early = c.status === "received" || c.status === "in_review";
  const actions: CaseAction[] = [];
  let approveBlockedReason: string | undefined;

  if (role === "case_manager") {
    if (c.status === "received") actions.push("start_review");
    // Ley Karin: antes de asignar hay que decidir si investiga la empresa o la DT (salvo que venga de la DT).
    if (karin && early && c.origin !== "dt") actions.push("set_route");
    const canInvestigate = !karin || c.route === "internal";
    if (canInvestigate && (c.status === "in_review" || c.status === "investigating")) actions.push("assign");
    if (["received", "in_review", "investigating"].includes(c.status)) actions.push("reclassify");
    if (open) actions.push("measure");
    if (open && milestones.some((m) => m.registrable && !m.done)) actions.push("milestone");
    // Flexibilidad del caso puntual: tareas propias y extensión de plazos internos (nunca de los legales).
    if (open) actions.push("add_task");
    if (open && milestones.some(isExtendable)) actions.push("extend_deadline");
    // En Ley Karin los avisos a la DT se registran como hitos del procedimiento.
    if (open && !karin) actions.push("authority");
    // Solo se puede escribir si el denunciante tiene clave de seguimiento para leer la respuesta.
    if (open && c.tracking_key_hash) actions.push("message");
    if (open) actions.push("note", "involve");
    // Una denuncia Ley Karin no se puede desestimar: siempre se investiga o se deriva a la DT.
    if (!karin && early) actions.push("dismiss");
  }
  if (role === "investigator" && c.investigator_id === ctx.me.id) {
    if (c.status === "investigating") actions.push("diligence", "propose");
    // Pasos del flujo de la empresa y tareas que le corresponden al investigador.
    if (open && milestones.some((m) => m.registrable && !m.done && m.owner === "investigator")) actions.push("milestone");
    if (open) actions.push("measure", "note");
    if (open && c.tracking_key_hash) actions.push("message");
  }
  if (role === "resolver" && c.status === "resolution") {
    const ownWork = c.investigator_id === ctx.me.id || c.proposed_by === ctx.me.id;
    // Una desestimación no exige los pasos del flujo (no hubo investigación).
    const missing = c.finding === "inadmissible" ? [] : pendingRequired(milestones);
    if (ctx.settings.caseRules.mode === "complete" && ownWork) {
      approveBlockedReason = "Participaste en este caso: en la modalidad completa otra persona del comité debe resolverlo.";
    } else if (missing.length) {
      approveBlockedReason = `Faltan pasos obligatorios del flujo de la empresa: ${missing.map((m) => m.label).join(", ")}. Devuelve el caso para completarlos.`;
      actions.push("reject");
    } else {
      actions.push("approve", "reject");
    }
  }
  return { actions, approveBlockedReason };
}

/** Investigadores que pueden tomar el caso: rol investigador, activos, con acceso a la categoría y no involucrados. */
function eligibleInvestigators(c: Pick<CaseRow, "category_id" | "involved_user_ids">, ctx: Ctx) {
  const category = ctx.categories.find((x) => x.id === c.category_id);
  if (!category) return [];
  return ctx.users.filter(
    (u) =>
      u.is_active &&
      u.roles.includes("investigator") &&
      !c.involved_user_ids.includes(u.id) &&
      effectiveCategories(u, [category]).length > 0,
  );
}

/* ------------------------------------------------------------------ Presentación */

interface MessageStats {
  total: number;
  unread: number;
}

function present(role: CaseRole, c: CaseRow, ctx: Ctx, milestones: Milestone[], stats?: MessageStats) {
  const category = ctx.categories.find((x) => x.id === c.category_id) as Category;
  const investigator = ctx.users.find((u) => u.id === c.investigator_id);
  const contentVisible = BASE_PERMISSIONS[role].viewContent;
  return {
    id: c.id,
    code: c.code,
    status: c.status,
    category: { id: category.id, name: category.name, framework: category.legal_framework },
    subject: contentVisible ? c.subject : `Denuncia de ${category.name.toLowerCase()}`,
    receivedAt: c.received_at,
    // Próximo vencimiento a cargo de la empresa según el procedimiento legal.
    dueAt: c.status === "closed" ? null : (nextDue(milestones) ?? c.due_at),
    closedAt: c.closed_at,
    isAnonymous: c.is_anonymous,
    investigator: investigator ? { id: investigator.id, name: contentVisible ? investigator.name : "Investigador asignado" } : null,
    origin: c.origin,
    route: c.route,
    // La persona pidió protección urgente y el caso sigue abierto.
    urgentProtection: c.urgent_protection && c.status !== "closed",
    isDemo: c.is_demo,
    // Mensajes del denunciante sin leer (solo para quienes conversan con él).
    unreadMessages: BASE_PERMISSIONS[role].message ? (stats?.unread ?? 0) : 0,
  };
}

function presentDetail(role: CaseRole, c: CaseRow, ctx: Ctx, milestones: Milestone[]) {
  const contentVisible = BASE_PERMISSIONS[role].viewContent;
  const { actions, approveBlockedReason } = availableActions(role, c, ctx, milestones);
  const userName = (id: string | null) => ctx.users.find((u) => u.id === id)?.name ?? null;

  return {
    ...present(role, c, ctx, milestones),
    description: contentVisible ? c.description : null,
    reporter:
      contentVisible && !c.is_anonymous
        ? { name: c.reporter_name, email: c.reporter_email, phone: c.reporter_phone, rut: c.reporter_rut }
        : null,
    // Si denunció un tercero en representación de la persona afectada.
    affected:
      contentVisible && !c.reporter_is_affected
        ? { name: c.affected_name, rut: c.affected_rut, email: c.affected_email, representation: c.representation }
        : null,
    reporterRelation: c.reporter_relation,
    occurredWhen: contentVisible ? c.occurred_when : null,
    occurredWhere: contentVisible ? c.occurred_where : null,
    originDetail: contentVisible ? c.origin_detail : null,
    topicDetail: contentVisible ? c.topic_detail : null,
    offenderRelation: c.offender_relation,
    ongoing: c.ongoing,
    originChannel: c.origin_channel,
    externalDueAt: c.external_due_at,
    // El denunciante puede leer y responder mensajes (tiene clave de seguimiento).
    reporterChannel: c.tracking_key_hash !== null,
    reporterRequestsDt: c.reporter_requests_dt,
    companyRelation: c.company_relation,
    companyRelationLabel: c.company_relation ? RELATION_LABEL[c.company_relation] : null,
    otherCompany: contentVisible ? c.other_company : null,
    involved: contentVisible
      ? c.involved
      : c.involved.map((p, i) => ({ name: `Persona ${String.fromCharCode(65 + i)}`, relation: p.relation })),
    // Usuarios del canal excluidos por conflicto de interés (solo el gestor administra esta lista).
    involvedUsers:
      role === "case_manager" ? c.involved_user_ids.map((id) => ({ id, name: userName(id) ?? "Usuario eliminado" })) : [],
    finding: c.finding,
    proposal: contentVisible ? c.proposal : c.proposal ? "Conclusión registrada (contenido reservado)" : null,
    proposedAt: c.proposed_at,
    proposedBy: contentVisible ? userName(c.proposed_by) : null,
    outcome: contentVisible ? c.outcome : c.outcome ? "Resolución registrada (contenido reservado)" : null,
    resolvedBy: contentVisible ? userName(c.resolved_by) : null,
    reportApprovedAt: c.report_approved_at,
    authorityNotifiedAt: c.authority_notified_at,
    // Procedimiento: hitos legales, del flujo de la empresa y tareas del caso. El auditor ve estados, fechas y
    // extensiones (con su motivo), sin notas.
    deadlines: milestones.map((m) => ({
      ...(contentVisible ? m : { ...m, note: null }),
      canRegister:
        m.registrable &&
        !m.done &&
        actions.includes("milestone") &&
        (role === "case_manager" || (role === "investigator" && m.owner === "investigator")),
      canExtend: role === "case_manager" && actions.includes("extend_deadline") && isExtendable(m),
    })),
    // Versión del flujo de la empresa con que se gestiona (null = recomendado; no aplica a Ley Karin).
    flowVersion: rulesOf(ctx.templates, c.flow_template_id).version,
    permissions: BASE_PERMISSIONS[role],
    actions,
    approveBlockedReason,
  };
}

async function messageStats(tenant: Tenant): Promise<Map<string, MessageStats & { lastAt: Date; lastSender: string; lastBody: string }>> {
  const res = await tenantPool(tenant).query<{
    case_id: string;
    total: string;
    unread: string;
    last_at: Date;
    last_sender: string;
    last_body: string;
  }>(
    `SELECT case_id, count(*) AS total,
            count(*) FILTER (WHERE sender = 'reporter' AND read_at IS NULL) AS unread,
            max(created_at) AS last_at,
            (array_agg(sender ORDER BY created_at DESC))[1] AS last_sender,
            (array_agg(body ORDER BY created_at DESC))[1] AS last_body
       FROM case_messages GROUP BY case_id`,
  );
  return new Map(
    res.rows.map((r) => [
      r.case_id,
      { total: Number(r.total), unread: Number(r.unread), lastAt: r.last_at, lastSender: r.last_sender, lastBody: r.last_body },
    ]),
  );
}

/* ------------------------------------------------------------------ Consultas */

/** Casos visibles para el rol, con su procedimiento calculado. */
async function visibleCases(tenant: Tenant, ctx: Ctx, role: CaseRole, where = "") {
  const pool = tenantPool(tenant);
  const [rows, records, flowData] = await Promise.all([
    pool.query<CaseRow>(`SELECT * FROM cases ${where} ORDER BY received_at DESC`),
    loadMilestones(pool),
    loadFlowData(pool),
  ]);
  return {
    all: rows.rows,
    visible: rows.rows
      .filter((c) => canSee(role, ctx.me, c, ctx.myCategoryIds))
      .map((c) => ({ c, milestones: milestonesOf(c, ctx, records, flowData) })),
  };
}

export async function listVisibleCases(tenant: Tenant, userId: string, role: CaseRole) {
  const ctx = await loadContext(tenant, userId);
  const [{ all, visible }, stats] = await Promise.all([visibleCases(tenant, ctx, role), messageStats(tenant)]);
  // Cuántas no se muestran por conflicto de interés (las vería con su rol si no estuviera involucrado).
  const hiddenByConflict = all.filter(
    (c) => c.involved_user_ids.includes(ctx.me.id) && canSee(role, ctx.me, { ...c, involved_user_ids: [] }, ctx.myCategoryIds),
  ).length;
  return { cases: visible.map(({ c, milestones }) => present(role, c, ctx, milestones, stats.get(c.id))), hiddenByConflict };
}

async function findVisibleCase(ctx: Ctx, role: CaseRole, id: string, db: pg.Pool | pg.PoolClient, lock = false) {
  const c = (await db.query<CaseRow>(`SELECT * FROM cases WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id])).rows[0];
  // Mismo 404 para "no existe", "no te corresponde" y "estás involucrado": no se revela que el caso existe.
  if (!c || !canSee(role, ctx.me, c, ctx.myCategoryIds)) throw new HttpError(404, "Denuncia no encontrada");
  const [records, flowData] = await Promise.all([loadMilestones(db, [c.id]), loadFlowData(db, [c.id])]);
  const milestones = milestonesOf(c, ctx, records, flowData);
  return { c, milestones };
}

interface EventRow {
  occurred_at: Date;
  actor_label: string;
  actor_role: string | null;
  action: string;
  detail: string | null;
  kind: string;
}

interface MessageRow {
  id: string;
  sender: "reporter" | "staff";
  author_user_id: string | null;
  body: string;
  created_at: Date;
  read_at: Date | null;
}

export async function getVisibleCase(tenant: Tenant, userId: string, role: CaseRole, id: string) {
  const ctx = await loadContext(tenant, userId);
  const pool = tenantPool(tenant);
  const { c, milestones } = await findVisibleCase(ctx, role, id, pool);
  const contentVisible = BASE_PERMISSIONS[role].viewContent;

  const [events, messages] = await Promise.all([
    pool.query<EventRow>(
      "SELECT occurred_at, actor_label, actor_role, action, detail, kind FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id",
      [id],
    ),
    contentVisible
      ? pool.query<MessageRow>("SELECT * FROM case_messages WHERE case_id = $1 ORDER BY created_at, id", [id])
      : Promise.resolve({ rows: [] as MessageRow[] }),
  ]);

  // Quien conversa con el denunciante deja leídos sus mensajes al abrir el caso.
  const { actions } = availableActions(role, c, ctx, milestones);
  if (actions.includes("message")) {
    await pool.query("UPDATE case_messages SET read_at = now() WHERE case_id = $1 AND sender = 'reporter' AND read_at IS NULL", [id]);
  }

  const options =
    role === "case_manager"
      ? {
          investigators: eligibleInvestigators(c, ctx).map((u) => ({ id: u.id, name: u.name, area: u.area })),
          categories: ctx.categories.filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.name, framework: x.legal_framework })),
          users: ctx.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.name, area: u.area })),
          milestoneResults: MILESTONE_RESULTS,
        }
      : null;

  return {
    case: presentDetail(role, c, ctx, milestones),
    // El auditor ve la trazabilidad sin nombres ni detalles que podrían identificar a alguien.
    events: events.rows.map((e) =>
      contentVisible
        ? e
        : { ...e, actor_label: e.actor_role ? (ROLE_LABEL[e.actor_role as CaseRole] ?? "Equipo") : e.actor_label, detail: null },
    ),
    messages: messages.rows.map((m) => ({
      id: m.id,
      sender: m.sender,
      author: m.sender === "reporter" ? "Denunciante" : (ctx.users.find((u) => u.id === m.author_user_id)?.name ?? "Equipo del canal"),
      body: m.body,
      createdAt: m.created_at,
      readAt: m.read_at,
    })),
    options,
  };
}

/** Todos los plazos pendientes a cargo de la empresa en las denuncias abiertas que el rol puede ver. */
export async function listDeadlines(tenant: Tenant, userId: string, role: CaseRole) {
  const ctx = await loadContext(tenant, userId);
  const { visible } = await visibleCases(tenant, ctx, role, "WHERE status <> 'closed'");
  const contentVisible = BASE_PERMISSIONS[role].viewContent;
  return visible
    .flatMap(({ c, milestones }) => {
      const category = ctx.categories.find((x) => x.id === c.category_id)!;
      return milestones
        .filter((d) => !d.done && d.dueAt && !d.optional)
        .map((d) => ({
          ...d,
          note: contentVisible ? d.note : null,
          case: {
            id: c.id,
            code: c.code,
            subject: contentVisible ? c.subject : `Denuncia de ${category.name.toLowerCase()}`,
            category: category.name,
            framework: category.legal_framework,
            isDemo: c.is_demo,
          },
        }));
    })
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
}

/** Bandeja de mensajes: conversaciones de las denuncias abiertas o cerradas que el rol gestiona. */
export async function listConversations(tenant: Tenant, userId: string, role: CaseRole) {
  if (!BASE_PERMISSIONS[role].message) return [];
  const ctx = await loadContext(tenant, userId);
  const [{ visible }, stats] = await Promise.all([visibleCases(tenant, ctx, role), messageStats(tenant)]);
  return visible
    .map(({ c, milestones }) => {
      const s = stats.get(c.id);
      return {
        case: present(role, c, ctx, milestones, s),
        total: s?.total ?? 0,
        unread: s?.unread ?? 0,
        lastAt: s?.lastAt ?? null,
        lastSender: s?.lastSender ?? null,
        lastBody: s ? s.lastBody.slice(0, 160) : null,
        // Denuncias del portal sin mensajes que aún esperan el acuse de recibo.
        awaitingAck: c.status !== "closed" && c.acknowledged_at === null && c.tracking_key_hash !== null,
        canReply: availableActions(role, c, ctx, milestones).actions.includes("message"),
      };
    })
    .filter((x) => x.total > 0 || x.awaitingAck)
    .sort((a, b) => b.unread - a.unread || (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
}

/** Documentos de referencia del canal para quienes gestionan denuncias. */
export async function getChannelResources(tenant: Tenant) {
  const { portal, caseRules } = await getSettings(tenant);
  return {
    policy: portal.policy,
    contactEmail: portal.contactEmail,
    mode: caseRules.mode,
    retentionMonths: caseRules.retentionMonths,
    hasConflictPlan: Boolean(caseRules.conflictPlan.substituteUserId || caseRules.conflictPlan.externalContact),
  };
}

/* ------------------------------------------------------------------ Acciones sobre un caso */

const text = (min: number, max: number, label: string) =>
  z
    .string({ message: `${label} es obligatorio` })
    .trim()
    .min(min, { message: min <= 1 ? `${label} es obligatorio` : `${label} debe tener al menos ${min} caracteres` })
    .max(max, { message: `${label} admite hasta ${max} caracteres` });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Fecha calendario (AAAA-MM-DD) en que ocurrió algo; por defecto, ahora. */
const pastDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha inválida" })
  .optional()
  .transform((v) => (v ? v : undefined));

/** Fecha AAAA-MM-DD de hoy en adelante; vence al final de ese día en Chile. */
const futureDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha inválida" })
  .refine((v) => v >= new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date()), {
    message: "La fecha no puede ser pasada",
  })
  .transform((v) => addCalendarDays(new Date(`${v}T12:00:00-04:00`), 0));

/** Convierte una fecha AAAA-MM-DD a un instante: si es hoy, ahora; si no, mediodía de ese día en Chile. */
function dateToInstant(date: string | undefined, notBefore: Date, label: string): Date {
  if (!date) return new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  if (date > today) throw new HttpError(400, `${label}: la fecha no puede ser futura`);
  const at = date === today ? new Date() : new Date(`${date}T12:00:00-04:00`);
  const floor = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(notBefore);
  if (date < floor) throw new HttpError(400, `${label}: la fecha no puede ser anterior a la recepción de la denuncia`);
  return at;
}

const COMPANY_RELATIONS = ["same", "contractor", "principal", "third_party"] as const;

export const ACTION_SCHEMAS = {
  start_review: z.object({}),
  reclassify: z.object({ categoryId: z.uuid({ message: "Selecciona una categoría" }), reason: text(5, 1000, "El motivo") }),
  involve: z.object({ userIds: z.array(z.uuid()).max(100) }),
  assign: z.object({ investigatorId: z.uuid({ message: "Selecciona un investigador" }) }),
  measure: z.object({ text: text(5, 2000, "La medida") }),
  authority: z.object({ authority: text(2, 120, "La autoridad"), detail: optionalText(2000) }),
  note: z.object({ text: text(3, 3000, "La nota") }),
  diligence: z.object({
    type: z.enum(["interview", "document", "inspection", "other"], { message: "Selecciona el tipo" }),
    text: text(5, 5000, "El detalle"),
  }),
  propose: z.object({
    finding: z.enum(["substantiated", "partially", "unsubstantiated"], { message: "Selecciona la conclusión" }),
    text: text(20, 8000, "El informe"),
  }),
  dismiss: z.object({ reason: text(20, 3000, "El fundamento") }),
  approve: z.object({ resolution: text(10, 5000, "La resolución"), reporterMessage: optionalText(3000) }),
  reject: z.object({ reason: text(10, 3000, "El motivo") }),
  message: z.object({ body: text(1, 5000, "El mensaje") }),
  set_route: z.object({
    route: z.enum(["internal", "dt"], { message: "Elige quién investiga" }),
    companyRelation: z.enum(COMPANY_RELATIONS, { message: "Indica qué empresas están involucradas" }),
    otherCompany: optionalText(150),
    reason: optionalText(1000),
  }),
  milestone: z.object({
    key: z.string().min(1).max(60),
    date: pastDate,
    result: optionalText(40),
    detail: optionalText(3000),
    reporterMessage: optionalText(3000),
  }),
  add_task: z.object({
    title: text(3, 120, "El título"),
    detail: optionalText(1000),
    assignee: z.enum(["case_manager", "investigator"], { message: "Indica quién la realiza" }),
    dueDate: futureDate.optional(),
  }),
  extend_deadline: z.object({
    key: z.string().min(1).max(60),
    date: futureDate,
    reason: text(10, 1000, "El motivo"),
  }),
} satisfies Record<CaseAction, z.ZodType>;

type ActionInput<A extends CaseAction> = z.infer<(typeof ACTION_SCHEMAS)[A]>;

const DILIGENCE_LABEL = {
  interview: "Entrevista",
  document: "Revisión documental",
  inspection: "Inspección o verificación en terreno",
  other: "Diligencia",
};

const RESULT_LABEL: Record<string, string> = {
  without_observations: "Sin observaciones",
  with_observations: "Con observaciones",
  no_ruling: "Sin pronunciamiento en plazo: las conclusiones se consideran válidas",
  breach: "Hubo una vulneración de seguridad",
  no_breach: "No hubo vulneración de seguridad",
};

export const ACK_MESSAGE =
  "Recibimos tu denuncia y ya está en revisión. Si necesitamos más antecedentes te escribiremos por este mismo medio; revisa tu seguimiento cada cierto tiempo con tu clave.";

/**
 * Aplica una acción del flujo. Todo ocurre en una transacción con la denuncia bloqueada, para que dos personas
 * no puedan, por ejemplo, aprobar y rechazar el mismo cierre a la vez.
 */
export async function applyCaseAction<A extends CaseAction>(
  tenant: Tenant,
  userId: string,
  role: CaseRole,
  id: string,
  action: A,
  rawInput: unknown,
): Promise<{ code: string; summary: string }> {
  const input = ACTION_SCHEMAS[action].parse(rawInput ?? {}) as ActionInput<A>;
  const ctx = await loadContext(tenant, userId);
  const client = await tenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const { c, milestones } = await findVisibleCase(ctx, role, id, client, true);
    const { actions, approveBlockedReason } = availableActions(role, c, ctx, milestones);
    if (!actions.includes(action)) {
      throw new HttpError(
        409,
        (action === "approve" || action === "reject") && approveBlockedReason
          ? approveBlockedReason
          : "Esta acción no está disponible para tu rol en el estado actual de la denuncia.",
      );
    }
    const karin = frameworkOf(c, ctx) === "ley_karin";

    const actor = `${ctx.me.name} · ${ROLE_LABEL[role]}`;
    const event = (label: string, detail: string | null = null, kind = "event") =>
      client.query(
        `INSERT INTO case_events (case_id, actor_label, actor_role, actor_user_id, action, detail, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [c.id, actor, role, ctx.me.id, label, detail, kind],
      );
    const update = (set: string, values: unknown[]) =>
      client.query(`UPDATE cases SET ${set} WHERE id = $1`, [c.id, ...values]);
    const staffMessage = async (body: string) => {
      await client.query("INSERT INTO case_messages (case_id, sender, author_user_id, body) VALUES ($1, 'staff', $2, $3)", [
        c.id,
        ctx.me.id,
        body,
      ]);
      // El primer contacto con el denunciante cuenta como acuse de recibo.
      await update("acknowledged_at = COALESCE(acknowledged_at, now())", []);
    };
    const categoryName = (catId: string) => ctx.categories.find((x) => x.id === catId)?.name ?? "—";
    let summary: string;

    switch (action) {
      case "start_review": {
        // Si investiga la DT, la empresa queda en seguimiento: medidas y espera del informe de la DT.
        await update("status = $2, acknowledged_at = COALESCE(acknowledged_at, now())", [c.route === "dt" ? "follow_up" : "in_review"]);
        const hasMailbox = c.tracking_key_hash !== null;
        if (hasMailbox) await staffMessage(ACK_MESSAGE);
        await event("Revisión iniciada", hasMailbox ? "Se envió el acuse de recibo al denunciante." : null);
        summary = hasMailbox
          ? "La denuncia pasó a revisión y se envió el acuse de recibo al denunciante."
          : "La denuncia pasó a revisión.";
        break;
      }
      case "reclassify": {
        const { categoryId, reason } = input as ActionInput<"reclassify">;
        const category = ctx.categories.find((x) => x.id === categoryId && x.is_active);
        if (!category) throw new HttpError(400, "Categoría no válida");
        if (category.id === c.category_id) throw new HttpError(400, "La denuncia ya está en esa categoría");
        if (c.origin === "dt" && category.legal_framework !== "ley_karin") {
          throw new HttpError(400, "Una denuncia notificada por la DT debe mantenerse en una categoría de Ley Karin.");
        }
        // Al salir de Ley Karin se descarta la definición de ruta; al entrar, habrá que definirla.
        const leavesKarin = category.legal_framework !== "ley_karin";
        await update(`category_id = $2, due_at = $3${leavesKarin ? ", route = NULL, company_relation = NULL" : ""}`, [
          category.id,
          caseDueDate(category.legal_framework, c.received_at),
        ]);
        // Entra al flujo vigente de su nuevo marco.
        await stampFlow(client, c.id, category.legal_framework, c.received_at);
        await event("Denuncia reclasificada", `De «${categoryName(c.category_id)}» a «${category.name}». Motivo: ${reason}`);
        summary = `Reclasificada como ${category.name}.`;
        break;
      }
      case "involve": {
        const { userIds } = input as ActionInput<"involve">;
        const valid = [...new Set(userIds)].filter((uid) => ctx.users.some((u) => u.id === uid));
        await update("involved_user_ids = $2", [valid]);
        // Si el investigador quedó involucrado, deja el caso y vuelve a revisión para reasignarlo.
        const investigatorOut = c.investigator_id !== null && valid.includes(c.investigator_id);
        if (investigatorOut) {
          await update("investigator_id = NULL, status = CASE WHEN status = 'investigating' THEN 'in_review' ELSE status END", []);
        }
        await event(
          "Conflicto de interés actualizado",
          `${valid.length} ${valid.length === 1 ? "usuario del canal queda excluido" : "usuarios del canal quedan excluidos"} de este caso.` +
            (investigatorOut ? " El investigador asignado quedó excluido y el caso vuelve a revisión." : ""),
        );
        summary = valid.includes(ctx.me.id)
          ? "Quedaste excluido de este caso por conflicto de interés; ya no lo verás."
          : "Se actualizaron las personas excluidas del caso.";
        break;
      }
      case "set_route": {
        const { route, companyRelation, otherCompany, reason } = input as ActionInput<"set_route">;
        if (c.reporter_requests_dt && route === "internal") {
          throw new HttpError(400, "El denunciante pidió que investigue la Dirección del Trabajo: la empresa debe derivarla (art. 211-C).");
        }
        if ((companyRelation === "contractor" || companyRelation === "principal") && !otherCompany) {
          throw new HttpError(400, "Indica el nombre de la otra empresa.");
        }
        await update("route = $2, company_relation = $3, other_company = $4, status = $5", [
          route,
          companyRelation,
          otherCompany ?? null,
          route === "dt" ? "follow_up" : c.status === "received" ? "in_review" : c.status,
        ]);
        await update("acknowledged_at = COALESCE(acknowledged_at, now())", []);
        const label = route === "internal" ? "Investigación interna" : "Investigación a cargo de la Dirección del Trabajo";
        await event(
          `Procedimiento definido: ${label}`,
          [RELATION_LABEL[companyRelation] + (otherCompany ? ` (${otherCompany})` : ""), reason].filter(Boolean).join(". "),
          "decision",
        );
        summary =
          route === "internal"
            ? "Investigación interna definida. Avisa a la DT del inicio dentro de 3 días hábiles y asigna al investigador."
            : "Se derivará a la DT. Registra la derivación dentro de 3 días hábiles; la empresa queda en seguimiento.";
        break;
      }
      case "milestone": {
        const { key, date, result, detail, reporterMessage } = input as ActionInput<"milestone">;
        const m = milestones.find((x) => x.key === key && x.registrable && !x.done);
        if (!m) throw new HttpError(400, "Ese hito no corresponde a esta denuncia, aún no corresponde registrarlo o ya fue registrado.");
        if (role === "investigator" && m.owner !== "investigator") {
          throw new HttpError(403, "Este paso lo registra el gestor de denuncias.");
        }
        // «Sin pronunciamiento» solo cuando ya venció el plazo de 30 días hábiles de la DT.
        if (key === "dt_ruling" && result === "no_ruling" && m.dueAt && m.dueAt.getTime() > Date.now()) {
          throw new HttpError(400, "Aún no vence el plazo de la DT para pronunciarse; registra su respuesta cuando llegue.");
        }
        const allowed = MILESTONE_RESULTS[key];
        if (allowed && (!result || !allowed.includes(result))) throw new HttpError(400, "Selecciona el resultado");
        if (key === "measures_applied" && !detail) throw new HttpError(400, "Describe las medidas y sanciones aplicadas");
        const at = dateToInstant(date, c.received_at, m.label);
        await client.query(
          "INSERT INTO case_milestones (case_id, key, done_at, result, detail, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)",
          [c.id, key, at, result ?? null, detail ?? null, ctx.me.id],
        );
        const parts = [result ? RESULT_LABEL[result] : null, detail].filter(Boolean).join(". ");
        await event(
          m.source === "task" ? `Tarea cumplida: ${m.label}` : m.source === "company" ? `Paso del flujo: ${m.label}` : m.label,
          parts || null,
          key.startsWith("dt_") || key === "agency_notice" ? "authority" : "decision",
        );
        summary = `Registrado: ${m.label}.`;
        // Aplicar las medidas finales cierra la denuncia.
        if (key === "measures_applied") {
          await update("status = 'closed', closed_at = $2, resolved_by = COALESCE(resolved_by, $3)", [at, ctx.me.id]);
          if (!c.outcome && detail) await update("outcome = $2", [detail]);
          if (reporterMessage && c.origin !== "dt") await staffMessage(reporterMessage);
          summary = "Medidas registradas: la denuncia quedó cerrada.";
        }
        break;
      }
      case "add_task": {
        const { title, detail, assignee, dueDate } = input as ActionInput<"add_task">;
        const count = await client.query<{ n: string }>("SELECT count(*) AS n FROM case_tasks WHERE case_id = $1", [c.id]);
        if (Number(count.rows[0]!.n) >= 30) throw new HttpError(400, "Este caso ya tiene 30 tareas.");
        await client.query(
          "INSERT INTO case_tasks (case_id, title, detail, assignee, due_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
          [c.id, title, detail ?? null, assignee, dueDate ?? null, ctx.me.id],
        );
        const who = assignee === "investigator" ? "investigador" : "gestor";
        await event(
          "Tarea agregada",
          `${title} (a cargo del ${who}${dueDate ? `, vence el ${formatChileDate(dueDate)}` : ""}).${detail ? ` ${detail}` : ""}`,
        );
        summary = `Tarea agregada: ${title}.`;
        break;
      }
      case "extend_deadline": {
        const { key, date, reason } = input as ActionInput<"extend_deadline">;
        const m = milestones.find((x) => x.key === key);
        if (!m || !isExtendable(m)) {
          throw new HttpError(400, m?.legal ? "Los plazos legales no se pueden extender." : "Ese plazo no se puede extender.");
        }
        if (date.getTime() <= m.dueAt!.getTime()) throw new HttpError(400, "La nueva fecha debe ser posterior al plazo actual.");
        await client.query(
          `INSERT INTO case_deadline_extensions (case_id, milestone_key, previous_due_at, new_due_at, reason, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [c.id, key, m.dueAt, date, reason, ctx.me.id],
        );
        await event(
          `Plazo extendido: ${m.label}`,
          `Del ${formatChileDate(m.dueAt!)} al ${formatChileDate(date)}. Motivo: ${reason}`,
          "decision",
        );
        summary = `Plazo extendido al ${formatChileDate(date)}.`;
        break;
      }
      case "assign": {
        const { investigatorId } = input as ActionInput<"assign">;
        const investigator = eligibleInvestigators(c, ctx).find((u) => u.id === investigatorId);
        if (!investigator) throw new HttpError(400, "Esa persona no puede investigar esta denuncia (rol, área o categoría)");
        if (investigator.id === c.investigator_id) throw new HttpError(400, "Ya es el investigador asignado");
        const previous = ctx.users.find((u) => u.id === c.investigator_id);
        await update("investigator_id = $2, status = 'investigating'", [investigator.id]);
        await event(previous ? "Investigador reasignado" : "Investigador asignado", previous ? `De ${previous.name} a ${investigator.name}.` : investigator.name);
        summary = `${investigator.name} quedó a cargo de la investigación.`;
        break;
      }
      case "measure": {
        const { text: detail } = input as ActionInput<"measure">;
        await update("measures_at = COALESCE(measures_at, now())", []);
        await event("Medida de resguardo", detail, "measure");
        summary = "Medida de resguardo registrada.";
        break;
      }
      case "authority": {
        const { authority, detail } = input as ActionInput<"authority">;
        await update("authority_notified_at = COALESCE(authority_notified_at, now())", []);
        await event(`Aviso a ${authority}`, detail ?? null, "authority");
        summary = `Aviso a ${authority} registrado.`;
        break;
      }
      case "note": {
        const { text: detail } = input as ActionInput<"note">;
        await event("Nota interna", detail, "note");
        summary = "Nota registrada.";
        break;
      }
      case "diligence": {
        const { type, text: detail } = input as ActionInput<"diligence">;
        await event(DILIGENCE_LABEL[type], detail, "diligence");
        summary = "Diligencia registrada.";
        break;
      }
      case "propose": {
        const { finding, text: report } = input as ActionInput<"propose">;
        const missing = pendingRequired(milestones, "investigator");
        if (missing.length) {
          throw new HttpError(409, `Antes de enviar la conclusión registra los pasos obligatorios: ${missing.map((m) => m.label).join(", ")}.`);
        }
        await update("status = 'resolution', finding = $2, proposal = $3, proposed_at = now(), proposed_by = $4", [
          finding,
          report,
          ctx.me.id,
        ]);
        await event("Conclusión propuesta", FINDING_LABEL[finding], "decision");
        summary = "Conclusión enviada al comité para su resolución.";
        break;
      }
      case "dismiss": {
        const { reason } = input as ActionInput<"dismiss">;
        await update("status = 'resolution', finding = 'inadmissible', proposal = $2, proposed_at = now(), proposed_by = $3", [
          reason,
          ctx.me.id,
        ]);
        await event("Desestimación propuesta", "El comité debe aprobarla para cerrar el caso.", "decision");
        summary = "Desestimación enviada al comité para su aprobación.";
        break;
      }
      case "approve": {
        const { resolution, reporterMessage } = input as ActionInput<"approve">;
        if (karin) {
          // Ley Karin: aprobar el informe termina la investigación; faltan el envío a la DT, su pronunciamiento
          // y la aplicación de medidas dentro de 15 días corridos.
          await update("status = 'follow_up', outcome = $2, report_approved_at = now(), resolved_by = $3", [resolution, ctx.me.id]);
          if (reporterMessage) await staffMessage(reporterMessage);
          await event("Informe final aprobado", c.finding ? FINDING_LABEL[c.finding] : null, "decision");
          summary = "Informe final aprobado. Envíalo a la DT dentro de 2 días hábiles; el caso queda en seguimiento.";
        } else {
          await update("status = 'closed', outcome = $2, closed_at = now(), resolved_by = $3", [resolution, ctx.me.id]);
          if (reporterMessage) await staffMessage(reporterMessage);
          await event("Cierre aprobado", c.finding ? FINDING_LABEL[c.finding] : null, "decision");
          summary = "La denuncia quedó cerrada.";
        }
        break;
      }
      case "reject": {
        const { reason } = input as ActionInput<"reject">;
        // Vuelve a quien corresponde: al investigador si lo hay; si era una desestimación, al gestor.
        const back = c.investigator_id ? "investigating" : "in_review";
        await update("status = $2, finding = NULL, proposal = NULL, proposed_at = NULL, proposed_by = NULL", [back]);
        await event(karin ? "Informe devuelto con observaciones" : "Cierre rechazado", reason, "decision");
        summary = back === "investigating" ? "El caso volvió al investigador." : "El caso volvió al gestor.";
        break;
      }
      case "message": {
        const { body } = input as ActionInput<"message">;
        await staffMessage(body);
        await event("Mensaje enviado al denunciante", null, "message");
        summary = "Mensaje enviado.";
        break;
      }
      default:
        throw new HttpError(400, "Acción no válida");
    }

    await client.query("COMMIT");
    return { code: c.code, summary };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ Registro de denuncias recibidas por otras vías */

/** Error de validación asociado a un campo (el frontend lo muestra junto a ese campo). */
function fieldError(path: string, message: string): never {
  throw new z.ZodError([{ code: "custom", path: path.split("."), message, input: undefined }]);
}

const involvedSchema = z
  .array(z.object({ name: text(2, 150, "El nombre o cargo"), relation: z.enum(["Persona denunciada", "Testigo", "Otra persona involucrada"]) }))
  .max(20)
  .default([]);

/** Datos de quien denuncia y, si es un tercero, de la persona afectada. */
const identityFields = {
  anonymous: z.boolean(),
  reporter: z
    .object({
      name: text(2, 150, "El nombre"),
      email: z.union([z.email({ message: "Correo inválido" }), z.literal("")]).optional(),
      phone: optionalText(40),
      rut: optionalText(20),
    })
    .optional(),
  reporterIsAffected: z.boolean().default(true),
  affected: z
    .object({ name: optionalText(150), rut: optionalText(20), email: optionalText(200) })
    .optional(),
  representation: optionalText(300),
};

type Identity = {
  anonymous: boolean;
  reporter?: { name: string; email?: string; phone?: string; rut?: string };
  reporterIsAffected: boolean;
  affected?: { name?: string; rut?: string; email?: string };
  representation?: string;
};

interface IdentityData {
  reporterRut: string | null;
  affected: { name: string; rut: string; email: string } | null;
  representation: string | null;
}

/**
 * Valida la identificación. En Ley Karin es obligatoria: la persona afectada se identifica con nombre, RUN y
 * correo personal (art. 11 DS 21/2024); si denuncia un tercero, identifica a la persona afectada y la
 * representación con que actúa. La DT no admite denuncias anónimas (Ord. N° 497/21).
 */
function checkIdentity(input: Identity, karin: boolean): IdentityData {
  const r = input.anonymous ? undefined : input.reporter;
  const reporterRut = r?.rut ? normalizeRut(r.rut) : null;
  if (r?.rut && !reporterRut) fieldError("reporter.rut", "RUN inválido");
  if (!karin) return { reporterRut, affected: null, representation: null };

  if (input.anonymous || !r) {
    fieldError(
      "anonymous",
      "Las denuncias de Ley Karin no pueden ser anónimas: la persona afectada debe identificarse (Dirección del Trabajo, Ord. N° 497/21).",
    );
  }
  if (input.reporterIsAffected) {
    if (!reporterRut) fieldError("reporter.rut", "El RUN es obligatorio en denuncias de Ley Karin");
    if (!r.email) fieldError("reporter.email", "El correo personal es obligatorio en denuncias de Ley Karin");
    return { reporterRut, affected: null, representation: null };
  }
  const a = input.affected ?? {};
  if (!a.name || a.name.length < 2) fieldError("affected.name", "Indica el nombre de la persona afectada");
  const affectedRut = a.rut ? normalizeRut(a.rut) : null;
  if (!affectedRut) fieldError("affected.rut", a.rut ? "RUN inválido" : "Indica el RUN de la persona afectada");
  if (!a.email || !z.email().safeParse(a.email).success) fieldError("affected.email", "Indica el correo personal de la persona afectada");
  if (!input.representation) fieldError("representation", "Indica la representación con que actúas (por ejemplo, poder simple)");
  return { reporterRut, affected: { name: a.name, rut: affectedRut, email: a.email }, representation: input.representation };
}

const REGISTER_ORIGINS = ["direct", "other_company", "internal", "dt", "court", "agency", "prosecutor", "other_authority"] as const;
const AUTHORITY_ORIGINS: Origin[] = ["dt", "court", "agency", "prosecutor", "other_authority"];

const ORIGIN_EVENT: Record<(typeof REGISTER_ORIGINS)[number], string> = {
  direct: "Denuncia recibida directamente y registrada",
  other_company: "Denuncia remitida por otra empresa",
  internal: "Caso detectado internamente",
  dt: "Denuncia notificada por la Dirección del Trabajo",
  court: "Acción judicial notificada por un tribunal",
  agency: "Reclamo notificado por la Agencia de Protección de Datos Personales",
  prosecutor: "Requerimiento del Ministerio Público o las policías",
  other_authority: "Denuncia notificada por una autoridad",
};

/** Categorías en que el gestor puede registrar denuncias (las que gestiona). */
export async function registerOptions(tenant: Tenant, userId: string) {
  const ctx = await loadContext(tenant, userId);
  return {
    categories: ctx.categories
      .filter((x) => x.is_active && ctx.myCategoryIds.has(x.id))
      .map((x) => ({ id: x.id, name: x.name, framework: x.legal_framework })),
  };
}

export const registerSchema = z.object({
  origin: z.enum(REGISTER_ORIGINS, { message: "Indica cómo llegó la denuncia" }),
  originChannel: z.enum(["verbal", "letter", "email", "phone", "intermediary"]).optional(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Indica la fecha" }),
  originDetail: optionalText(300),
  externalDueDate: pastDate,
  companyRelation: z.enum(["contractor", "principal"]).optional(),
  otherCompany: optionalText(150),
  categoryId: z.uuid({ message: "Selecciona la categoría" }),
  subject: text(5, 150, "El título"),
  description: text(20, 10000, "El relato o acta"),
  occurredWhen: optionalText(200),
  occurredWhere: optionalText(200),
  involved: involvedSchema,
  ...identityFields,
  reporterRequestsDt: z.boolean().default(false),
  issueKey: z.boolean().default(true),
});

/**
 * El gestor registra una denuncia que no llegó por el portal:
 * - recibida por la empresa: directa (verbal con acta, carta, correo, teléfono o a través de un intermediario),
 *   remitida por otra empresa (régimen de subcontratación) o detectada internamente (auditoría, monitoreo);
 * - notificada por una autoridad: Dirección del Trabajo, tribunales, Agencia de Protección de Datos, Ministerio
 *   Público u otra, con el plazo que esa autoridad fije.
 * Si hay denunciante, puede recibir clave de seguimiento para usar el buzón seguro.
 */
export async function registerCase(tenant: Tenant, userId: string, raw: unknown) {
  const input = registerSchema.parse(raw);
  const ctx = await loadContext(tenant, userId);
  const category = ctx.categories.find((x) => x.id === input.categoryId && x.is_active);
  if (!category) fieldError("categoryId", "Selecciona la categoría");
  if (!ctx.myCategoryIds.has(category.id)) throw new HttpError(403, "No gestionas esa categoría: no podrías ver la denuncia.");
  const framework = category.legal_framework;
  const karin = framework === "ley_karin";
  const fromDt = input.origin === "dt";
  const withReporter = REPORTER_ORIGINS.includes(input.origin);

  if (fromDt && !karin) fieldError("categoryId", "La Dirección del Trabajo notifica denuncias de Ley Karin: elige una de esas categorías.");
  if (input.origin === "agency" && framework !== "ley_21719") {
    fieldError("categoryId", "Los reclamos de la Agencia corresponden a protección de datos personales (Ley 21.719).");
  }
  if (input.origin === "direct" && !input.originChannel) fieldError("originChannel", "Indica cómo se recibió");
  if (input.origin === "other_company" && (!input.companyRelation || !input.otherCompany)) {
    fieldError("otherCompany", "Indica qué empresa la remitió y su relación con la tuya");
  }
  const receivedAt = dateToInstant(input.receivedDate, new Date(0), "Fecha de recepción");
  let externalDue: Date | null = null;
  if (input.externalDueDate) {
    if (!AUTHORITY_ORIGINS.includes(input.origin) || fromDt) fieldError("externalDueDate", "El plazo externo solo aplica a requerimientos de una autoridad");
    externalDue = new Date(`${input.externalDueDate}T12:00:00-04:00`);
    if (externalDue < receivedAt) fieldError("externalDueDate", "El plazo no puede ser anterior a la recepción");
  }
  // Identificación obligatoria en Ley Karin cuando hay denunciante (no si la notifica una autoridad).
  const identity = checkIdentity(input, karin && withReporter);

  const pool = tenantPool(tenant);
  const trackingKey = withReporter && input.issueKey ? newTrackingKey() : null;
  const seq = (await pool.query<{ n: string }>("SELECT nextval('case_number_seq') AS n")).rows[0]!.n;
  const code = `DEN-${receivedAt.getFullYear()}-${String(seq).padStart(4, "0")}`;
  const reporter = input.anonymous ? undefined : input.reporter;

  const res = await pool.query<{ id: string }>(
    `INSERT INTO cases (code, category_id, status, subject, description, is_anonymous, reporter_name, reporter_email, reporter_phone,
                        occurred_when, occurred_where, involved, received_at, due_at, tracking_key_hash, origin, origin_detail,
                        route, reporter_requests_dt, acknowledged_at, origin_channel, external_due_at, company_relation,
                        other_company, reporter_rut, reporter_is_affected, affected_name, affected_rut, affected_email, representation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
             $25, $26, $27, $28, $29, $30) RETURNING id`,
    [
      code,
      category.id,
      fromDt ? "follow_up" : "received",
      input.subject,
      input.description,
      input.anonymous,
      reporter?.name ?? null,
      reporter?.email || null,
      reporter?.phone ?? null,
      input.occurredWhen ?? null,
      input.occurredWhere ?? null,
      JSON.stringify(input.involved),
      receivedAt,
      caseDueDate(framework, receivedAt),
      trackingKey ? hashKey(trackingKey) : null,
      input.origin,
      input.originDetail ?? null,
      fromDt ? "dt" : null,
      karin && !fromDt && input.reporterRequestsDt,
      fromDt ? receivedAt : null,
      input.origin === "direct" ? input.originChannel : null,
      externalDue,
      input.origin === "other_company" ? input.companyRelation : null,
      input.origin === "other_company" ? input.otherCompany : null,
      identity.reporterRut,
      !identity.affected,
      identity.affected?.name ?? null,
      identity.affected?.rut ?? null,
      identity.affected?.email ?? null,
      identity.representation,
    ],
  );
  // Versión vigente del flujo de la empresa para este marco.
  await stampFlow(pool, res.rows[0]!.id, framework, receivedAt);
  const actor = `${ctx.me.name} · ${ROLE_LABEL.case_manager}`;
  await pool.query(
    `INSERT INTO case_events (case_id, actor_label, actor_role, actor_user_id, action, detail, kind)
     VALUES ($1, $2, 'case_manager', $3, $4, $5, 'event')`,
    [res.rows[0]!.id, actor, ctx.me.id, ORIGIN_EVENT[input.origin], input.originDetail ?? null],
  );
  return { id: res.rows[0]!.id, code, trackingKey };
}

/* ------------------------------------------------------------------ Portal del denunciante */

export const REPORTER_RELATIONS = ["Trabajador(a)", "Ex trabajador(a)", "Proveedor o contratista", "Cliente", "Otro"] as const;

/** Qué ve el denunciante: nunca el nombre de quien gestiona ni el detalle interno. */
const PUBLIC_STATUS: Record<CaseStatus, { label: string; description: string }> = {
  received: { label: "Recibida", description: "Tu denuncia llegó al canal y pronto será revisada." },
  in_review: { label: "En revisión", description: "El equipo del canal está evaluando los antecedentes." },
  investigating: { label: "En investigación", description: "Se está investigando lo que informaste." },
  resolution: { label: "En investigación", description: "La investigación está por concluir." },
  follow_up: { label: "En etapa final", description: "La investigación concluyó y se están tramitando las medidas que correspondan." },
  closed: { label: "Cerrada", description: "El caso fue resuelto. Revisa los mensajes para conocer la respuesta." },
};

export async function getPublicPortal(tenant: Tenant) {
  const [settings, categories] = await Promise.all([getSettings(tenant), listCategories(tenant)]);
  return {
    company: tenant.name,
    portal: settings.portal,
    retentionMonths: settings.caseRules.retentionMonths,
    relations: REPORTER_RELATIONS,
    categories: categories
      .filter((c) => c.is_active)
      .map((c) => ({ id: c.id, name: c.name, description: c.description, framework: c.legal_framework, asksDetail: c.asks_detail })),
  };
}

export const reportSchema = z
  .object({
    categoryId: z.uuid({ message: "Selecciona de qué se trata" }),
    subject: text(5, 150, "El título"),
    description: text(30, 10000, "El relato"),
    occurredWhen: optionalText(200),
    occurredWhere: optionalText(200),
    involved: z
      .array(z.object({ name: text(2, 150, "El nombre o cargo"), relation: z.enum(["Persona denunciada", "Testigo", "Otra persona involucrada"]) }))
      .max(20)
      .default([]),
    relation: z.enum(REPORTER_RELATIONS).optional(),
    ...identityFields,
    // Ley Karin: el denunciante puede pedir que investigue la Dirección del Trabajo.
    requestsDt: z.boolean().default(false),
    // Categoría «Otro»: de qué se trata, en palabras de la persona.
    topicDetail: optionalText(300),
    // Ley Karin: contexto para que el gestor actúe con rapidez.
    offenderRelation: z.enum(OFFENDER_RELATIONS).optional(),
    ongoing: z.enum(["yes", "no", "unknown"]).optional(),
    urgentProtection: z.boolean().default(false),
    privacyAccepted: z.literal(true, { message: "Debes aceptar el aviso de privacidad" }),
  })
  .superRefine((v, ctx) => {
    if (!v.anonymous && !v.reporter) ctx.addIssue({ code: "custom", path: ["reporter", "name"], message: "Tu nombre es obligatorio" });
  });

/** Clave de seguimiento: 80 bits aleatorios, en grupos de 4 para que sea fácil de copiar. */
function newTrackingKey(): string {
  return base32Encode(randomBytes(10)).match(/.{4}/g)!.join("-");
}
const hashKey = (key: string) => sha256(key.toUpperCase().replace(/[^A-Z2-7]/g, ""));

/** Recibe una denuncia desde el portal público. No se guarda la IP ni datos del dispositivo. */
export async function submitReport(tenant: Tenant, raw: unknown): Promise<{ id: string; code: string; trackingKey: string }> {
  const input = reportSchema.parse(raw);
  const { portal } = await getSettings(tenant);
  if (input.anonymous && !portal.allowAnonymous) {
    throw new HttpError(400, "Este canal requiere que te identifiques para recibir la denuncia.");
  }
  const category = (await listCategories(tenant)).find((c) => c.id === input.categoryId && c.is_active);
  if (!category) throw new HttpError(400, "Selecciona de qué se trata");
  const identity = checkIdentity(input, category.legal_framework === "ley_karin");
  const karin = category.legal_framework === "ley_karin";
  if (category.asks_detail && (!input.topicDetail || input.topicDetail.length < 5)) {
    fieldError("topicDetail", "Cuéntanos brevemente de qué se trata");
  }
  if (karin && !input.offenderRelation) fieldError("offenderRelation", "Indica quién realizó la conducta");

  const pool = tenantPool(tenant);
  const trackingKey = newTrackingKey();
  const receivedAt = new Date();
  const seq = (await pool.query<{ n: string }>("SELECT nextval('case_number_seq') AS n")).rows[0]!.n;
  const code = `DEN-${receivedAt.getFullYear()}-${String(seq).padStart(4, "0")}`;
  const reporter = input.anonymous ? undefined : input.reporter;

  const res = await pool.query<{ id: string }>(
    `INSERT INTO cases (code, category_id, subject, description, is_anonymous, reporter_name, reporter_email, reporter_phone,
                        reporter_relation, occurred_when, occurred_where, involved, received_at, due_at,
                        tracking_key_hash, reporter_requests_dt, reporter_rut, reporter_is_affected, affected_name,
                        affected_rut, affected_email, representation, topic_detail, offender_relation, ongoing,
                        urgent_protection, privacy_accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
             $24, $25, $26, now())
     RETURNING id`,
    [
      code,
      category.id,
      input.subject,
      input.description,
      input.anonymous,
      reporter?.name ?? null,
      reporter?.email || null,
      reporter?.phone ?? null,
      input.relation ?? null,
      input.occurredWhen ?? null,
      input.occurredWhere ?? null,
      JSON.stringify(input.involved),
      receivedAt,
      caseDueDate(category.legal_framework, receivedAt),
      hashKey(trackingKey),
      category.legal_framework === "ley_karin" && input.requestsDt,
      identity.reporterRut,
      !identity.affected,
      identity.affected?.name ?? null,
      identity.affected?.rut ?? null,
      identity.affected?.email ?? null,
      identity.representation,
      category.asks_detail ? (input.topicDetail ?? null) : null,
      karin ? (input.offenderRelation ?? null) : null,
      karin ? (input.ongoing ?? null) : null,
      karin && input.urgentProtection,
    ],
  );
  // Versión vigente del flujo de la empresa para este marco.
  await stampFlow(pool, res.rows[0]!.id, category.legal_framework, receivedAt);
  await pool.query(
    "INSERT INTO case_events (case_id, actor_label, action, detail) VALUES ($1, 'Sistema', 'Denuncia recibida por el canal', $2)",
    [
      res.rows[0]!.id,
      [
        input.anonymous ? "Denuncia anónima." : "Denunciante identificado.",
        category.legal_framework === "ley_karin" && input.requestsDt ? "El denunciante pide que investigue la Dirección del Trabajo." : null,
        karin && input.urgentProtection ? "Pide medidas de protección urgentes." : null,
      ]
        .filter(Boolean)
        .join(" "),
    ],
  );
  return { id: res.rows[0]!.id, code, trackingKey };
}

async function findByKey(tenant: Tenant, key: string): Promise<CaseRow> {
  const normalized = key.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const c =
    normalized.length === 16
      ? (await tenantPool(tenant).query<CaseRow>("SELECT * FROM cases WHERE tracking_key_hash = $1", [hashKey(key)])).rows[0]
      : undefined;
  if (!c) throw new HttpError(404, "La clave no corresponde a ninguna denuncia de este canal. Revisa que esté bien escrita.");
  return c;
}

async function caseById(tenant: Tenant, id: string): Promise<CaseRow> {
  const c = (await tenantPool(tenant).query<CaseRow>("SELECT * FROM cases WHERE id = $1", [id])).rows[0];
  if (!c) throw new HttpError(401, "Tu sesión expiró. Vuelve a ingresar.");
  return c;
}

/** Acceso con la clave de seguimiento. Devuelve el id de la denuncia. */
export async function authenticateByKey(tenant: Tenant, key: string): Promise<string> {
  return (await findByKey(tenant, key)).id;
}

const TOTP_MAX_FAILURES = 5;
const TOTP_LOCK_MINUTES = 15;

/**
 * Acceso con el código de la denuncia y el de la app de autenticación. Como el código de denuncia es correlativo y
 * el de la app tiene 6 dígitos, cada denuncia se bloquea 15 minutos tras 5 intentos fallidos (además del límite por
 * conexión). La clave de seguimiento sigue funcionando durante el bloqueo.
 */
export async function authenticateByAuthenticator(tenant: Tenant, code: string, otp: string): Promise<string> {
  const pool = tenantPool(tenant);
  const row = (
    await pool.query<{
      id: string;
      totp_secret: string | null;
      totp_enabled_at: Date | null;
      totp_last_step: string | null;
      totp_locked_until: Date | null;
    }>("SELECT id, totp_secret, totp_enabled_at, totp_last_step, totp_locked_until FROM cases WHERE code = $1", [
      code.trim().toUpperCase(),
    ])
  ).rows[0];
  // Mismo mensaje si la denuncia no existe, no tiene app asociada o el código es incorrecto.
  const invalid = new HttpError(401, "El código de la denuncia o el de la app no son correctos.");
  if (!row || !row.totp_enabled_at || !row.totp_secret) throw invalid;
  if (row.totp_locked_until && row.totp_locked_until.getTime() > Date.now()) {
    throw new HttpError(429, `Demasiados intentos fallidos. Espera ${TOTP_LOCK_MINUTES} minutos o ingresa con tu clave de seguimiento.`);
  }
  const step = verifyTotp(decryptSecret(row.totp_secret), otp.trim(), row.totp_last_step === null ? null : Number(row.totp_last_step));
  if (step === null) {
    const failed = (
      await pool.query<{ n: number }>(
        "UPDATE cases SET totp_failed_attempts = totp_failed_attempts + 1 WHERE id = $1 RETURNING totp_failed_attempts AS n",
        [row.id],
      )
    ).rows[0]!.n;
    if (failed >= TOTP_MAX_FAILURES) {
      await pool.query(
        `UPDATE cases SET totp_failed_attempts = 0, totp_locked_until = now() + interval '${TOTP_LOCK_MINUTES} minutes' WHERE id = $1`,
        [row.id],
      );
    }
    throw invalid;
  }
  // Guarda el paso usado para que el mismo código no sirva dos veces.
  await pool.query("UPDATE cases SET totp_last_step = $2, totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = $1", [
    row.id,
    step,
  ]);
  return row.id;
}

/** Seguimiento del denunciante. Marca como leídos los mensajes del equipo. */
export async function getReporterView(tenant: Tenant, caseId: string) {
  const c = await caseById(tenant, caseId);
  const pool = tenantPool(tenant);
  const [category, messages] = await Promise.all([
    pool.query<{ name: string }>("SELECT name FROM categories WHERE id = $1", [c.category_id]),
    pool.query<MessageRow>("SELECT * FROM case_messages WHERE case_id = $1 ORDER BY created_at, id", [c.id]),
  ]);
  await pool.query("UPDATE case_messages SET read_at = now() WHERE case_id = $1 AND sender = 'staff' AND read_at IS NULL", [c.id]);
  return {
    code: c.code,
    subject: c.subject,
    category: category.rows[0]?.name ?? "",
    status: c.status === "resolution" || c.status === "follow_up" ? "investigating" : c.status,
    statusLabel: PUBLIC_STATUS[c.status].label,
    statusDescription: PUBLIC_STATUS[c.status].description,
    receivedAt: c.received_at,
    acknowledgedAt: c.acknowledged_at,
    closedAt: c.closed_at,
    isAnonymous: c.is_anonymous,
    canReply: c.status !== "closed",
    authenticatorEnabled: c.totp_enabled_at !== null,
    messages: messages.rows.map((m) => ({
      id: m.id,
      sender: m.sender,
      body: m.body,
      createdAt: m.created_at,
      // Para el denunciante: si el equipo ya leyó su mensaje.
      readAt: m.sender === "reporter" ? m.read_at : null,
    })),
  };
}

export async function addReporterMessage(tenant: Tenant, caseId: string, body: string) {
  const c = await caseById(tenant, caseId);
  if (c.status === "closed") throw new HttpError(409, "La denuncia está cerrada y ya no recibe mensajes.");
  const pool = tenantPool(tenant);
  await pool.query("INSERT INTO case_messages (case_id, sender, body) VALUES ($1, 'reporter', $2)", [c.id, body]);
  await pool.query(
    "INSERT INTO case_events (case_id, actor_label, action, kind) VALUES ($1, 'Denunciante', 'Mensaje del denunciante', 'message')",
    [c.id],
  );
}

/**
 * Asociar una app de autenticación: se genera un secreto nuevo (pendiente hasta confirmarlo con un código).
 * La cuenta aparece en la app como «Seguimiento: DEN-AAAA-NNNN», sin el nombre del canal, por discreción.
 */
export async function authenticatorSetup(tenant: Tenant, caseId: string) {
  const c = await caseById(tenant, caseId);
  if (c.totp_enabled_at) throw new HttpError(409, "Esta denuncia ya tiene una app de autenticación asociada.");
  const secret = generateTotpSecret();
  await tenantPool(tenant).query("UPDATE cases SET totp_secret = $2 WHERE id = $1", [c.id, encryptSecret(secret)]);
  const url = otpauthUrl(secret, "Seguimiento", c.code);
  return {
    code: c.code,
    secret,
    qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }),
  };
}

export async function authenticatorConfirm(tenant: Tenant, caseId: string, otp: string) {
  const c = await caseById(tenant, caseId);
  if (c.totp_enabled_at) throw new HttpError(409, "Esta denuncia ya tiene una app de autenticación asociada.");
  if (!c.totp_secret) throw new HttpError(400, "Primero escanea el código QR.");
  const step = verifyTotp(decryptSecret(c.totp_secret), otp.trim(), null);
  if (step === null) throw new HttpError(400, "El código no es correcto. Revisa que la hora de tu teléfono esté bien.");
  await tenantPool(tenant).query(
    "UPDATE cases SET totp_enabled_at = now(), totp_last_step = $2, totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = $1",
    [c.id, step],
  );
}

/** Quitar la app (por ejemplo, si cambió de teléfono). Solo con sesión iniciada. */
export async function authenticatorRemove(tenant: Tenant, caseId: string) {
  const c = await caseById(tenant, caseId);
  await tenantPool(tenant).query(
    "UPDATE cases SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = $1",
    [c.id],
  );
}
/* ------------------------------------------------------------------ Denuncias de ejemplo */

export async function countDemoCases(tenant: Tenant): Promise<number> {
  const res = await tenantPool(tenant).query<{ count: string }>("SELECT count(*) FROM cases WHERE is_demo");
  return Number(res.rows[0]!.count);
}

export async function clearDemoCases(tenant: Tenant): Promise<number> {
  const res = await tenantPool(tenant).query("DELETE FROM cases WHERE is_demo");
  return res.rowCount ?? 0;
}

interface DemoCase {
  category: string;
  status: CaseStatus;
  daysAgo: number;
  subject: string;
  description: string;
  reporter?: { name: string; email: string; rut?: string };
  involved: { name: string; relation: string }[];
  /** Marca como involucrado a un gestor del canal para mostrar la exclusión por conflicto de interés. */
  involveManager?: boolean;
  /** Conclusión del investigador (casos por resolver o cerrados). */
  proposal?: string;
  outcome?: string;
  messages?: [number, "reporter" | "staff", string][];
  events: [number, string, string, string?][];
}

const DEMO_CASES: DemoCase[] = [
  {
    category: "Acoso laboral",
    status: "investigating",
    daysAgo: 16,
    subject: "Trato hostil y humillaciones reiteradas de jefatura",
    // Ley Karin no admite denuncias anónimas: la persona afectada se identifica (datos ficticios).
    reporter: { name: "Trabajadora de bodega (ficticia)", email: "bodega.ejemplo@correo.cl", rut: "11111111-1" },
    description:
      "Desde hace varios meses mi jefatura directa me grita frente al equipo, me asigna tareas imposibles de cumplir y hace comentarios burlescos sobre mi trabajo en las reuniones. Otros compañeros lo han presenciado.",
    involved: [
      { name: "Jefatura de bodega (ficticio)", relation: "Persona denunciada" },
      { name: "Compañero de turno (ficticio)", relation: "Testigo" },
    ],
    messages: [
      [15, "staff", ACK_MESSAGE],
      [10, "staff", "¿Podrías indicarnos las fechas aproximadas de las reuniones en que ocurrieron los comentarios?"],
      [9, "reporter", "Fueron en las reuniones de los lunes de marzo y abril, sobre todo la del 14 de abril."],
    ],
    events: [
      [16, "Sistema", "Denuncia recibida por el canal"],
      [15, "Gestor", "Denuncia clasificada como Ley Karin"],
      [15, "Gestor", "Medida de resguardo", "Separación de espacios de trabajo y cambio de turno de la persona denunciante."],
      [14, "Gestor", "Aviso a la Dirección del Trabajo enviado"],
      [13, "Gestor", "Investigador asignado"],
      [9, "Investigador", "Diligencia registrada", "Entrevista a la persona denunciante."],
      [6, "Investigador", "Diligencia registrada", "Entrevista a testigo."],
    ],
  },
  {
    category: "Acoso sexual",
    status: "received",
    daysAgo: 1,
    subject: "Comentarios y contacto físico no consentido",
    description:
      "Un compañero de otra área me hace comentarios de connotación sexual y en dos ocasiones intentó tocarme sin mi consentimiento en la sala de descanso.",
    reporter: { name: "Denunciante de ejemplo", email: "denunciante@ejemplo.cl", rut: "33333333-3" },
    involved: [{ name: "Compañero de otra área (ficticio)", relation: "Persona denunciada" }],
    events: [[1, "Sistema", "Denuncia recibida por el canal"]],
  },
  {
    category: "Violencia en el trabajo",
    status: "in_review",
    daysAgo: 3,
    subject: "Agresiones verbales de un cliente en atención",
    reporter: { name: "Ejecutivo de atención (ficticio)", email: "atencion.ejemplo@correo.cl", rut: "22222222-2" },
    description:
      "Un cliente frecuente insulta y amenaza al personal de atención. El caso involucra además a la persona encargada de recibir las denuncias, que presenció los hechos y no los informó.",
    involved: [
      { name: "Cliente frecuente (ficticio)", relation: "Persona denunciada" },
      { name: "Encargado del área (usuario del canal)", relation: "Persona involucrada" },
    ],
    involveManager: true,
    events: [
      [3, "Sistema", "Denuncia recibida por el canal"],
      [2, "Sistema", "Conflicto de interés detectado", "La denuncia involucra a un gestor del canal; se deriva al plan ante conflicto."],
    ],
  },
  {
    category: "Delitos económicos y corrupción",
    status: "in_review",
    daysAgo: 5,
    subject: "Posible cobro de comisiones a proveedores",
    description:
      "Tengo antecedentes de que una persona del área de compras estaría pidiendo un porcentaje a proveedores a cambio de adjudicarles contratos. Adjunto correos reenviados por un proveedor.",
    involved: [{ name: "Analista de compras (ficticio)", relation: "Persona denunciada" }],
    messages: [
      [4, "staff", ACK_MESSAGE],
      [2, "reporter", "Tengo otros dos correos que no alcancé a adjuntar. ¿Cómo se los hago llegar?"],
    ],
    events: [
      [5, "Sistema", "Denuncia recibida por el canal"],
      [4, "Gestor", "Acuse de recibo enviado al denunciante"],
      [3, "Gestor", "Evidencia revisada", "Correos adjuntos verificados como auténticos."],
    ],
  },
  {
    category: "Conflicto de interés",
    status: "resolution",
    daysAgo: 45,
    subject: "Adjudicación a empresa de un familiar",
    description:
      "Un gerente habría adjudicado un servicio de transporte a una empresa de propiedad de su cónyuge, sin declarar el vínculo.",
    involved: [{ name: "Gerente de operaciones (ficticio)", relation: "Persona denunciada" }],
    proposal: "Se acredita el vínculo no declarado. Se propone amonestación escrita y revisión del contrato.",
    events: [
      [45, "Sistema", "Denuncia recibida por el canal"],
      [44, "Gestor", "Investigador asignado"],
      [30, "Investigador", "Diligencia registrada", "Revisión de registros de adjudicación y declaración de intereses."],
      [4, "Investigador", "Conclusión propuesta", "Hechos acreditados"],
    ],
  },
  {
    category: "Seguridad y salud en el trabajo",
    status: "closed",
    daysAgo: 60,
    subject: "Falta de elementos de protección en planta",
    description: "En el turno de noche no se entregan guantes ni lentes de seguridad para la operación de la máquina cortadora.",
    involved: [],
    proposal: "Se confirma que el turno de noche no recibía elementos de protección.",
    outcome: "Se confirma el incumplimiento. Se regularizó la entrega de elementos de protección y se capacitó al turno.",
    messages: [
      [59, "staff", ACK_MESSAGE],
      [35, "staff", "Gracias por informar. Confirmamos el problema y ya se regularizó la entrega de elementos de protección."],
    ],
    events: [
      [60, "Sistema", "Denuncia recibida por el canal"],
      [58, "Gestor", "Investigador asignado"],
      [40, "Investigador", "Conclusión propuesta"],
      [35, "Comité", "Cierre aprobado", "Medidas correctivas implementadas."],
    ],
  },
  {
    category: "Discriminación",
    status: "investigating",
    daysAgo: 100,
    subject: "Exclusión de capacitaciones por edad",
    description: "A las personas mayores de 50 años del área no se les considera para las capacitaciones ni para los ascensos.",
    involved: [{ name: "Jefatura de área (ficticio)", relation: "Persona denunciada" }],
    events: [
      [100, "Sistema", "Denuncia recibida por el canal"],
      [95, "Gestor", "Investigador asignado"],
      [60, "Investigador", "Diligencia registrada", "Revisión de registros de capacitación."],
    ],
  },
];

/** Carga denuncias ficticias para conocer las vistas de cada rol antes de habilitar el canal. */
export async function seedDemoCases(tenant: Tenant): Promise<number> {
  const [categories, users] = await Promise.all([listCategories(tenant), listUsers(tenant)]);
  const active = users.filter((u) => u.is_active);
  const pool = tenantPool(tenant);
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86_400_000);
  let created = 0;

  for (const demo of DEMO_CASES) {
    const category = categories.find((c) => c.name === demo.category && c.is_active);
    if (!category) continue;

    // Investigador: el primero que efectivamente pueda ver la categoría.
    const needsInvestigator = ["investigating", "resolution", "closed"].includes(demo.status);
    const investigator = needsInvestigator
      ? active.find((u) => u.roles.includes("investigator") && effectiveCategories(u, [category]).length > 0)
      : undefined;
    const manager = demo.involveManager
      ? active.find((u) => u.roles.includes("case_manager") && effectiveCategories(u, [category]).length > 0)
      : undefined;

    const receivedAt = ago(demo.daysAgo);
    const reviewed = demo.status !== "received";
    const proposed = demo.status === "resolution" || demo.status === "closed";
    const seq = (await pool.query<{ n: string }>("SELECT nextval('case_number_seq') AS n")).rows[0]!.n;
    const code = `DEN-${receivedAt.getFullYear()}-${String(seq).padStart(4, "0")}`;

    const res = await pool.query<{ id: string }>(
      `INSERT INTO cases (code, category_id, status, subject, description, is_anonymous, reporter_name, reporter_email,
                          involved, involved_user_ids, investigator_id, received_at, due_at, closed_at, outcome, is_demo,
                          acknowledged_at, measures_at, authority_notified_at, finding, proposal, proposed_at, proposed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id`,
      [
        code,
        category.id,
        demo.status,
        demo.subject,
        demo.description,
        !demo.reporter,
        demo.reporter?.name ?? null,
        demo.reporter?.email ?? null,
        JSON.stringify(demo.involved),
        manager ? [manager.id] : [],
        investigator?.id ?? null,
        receivedAt,
        caseDueDate(category.legal_framework, receivedAt),
        demo.status === "closed" ? ago(35) : null,
        demo.outcome ?? null,
        reviewed ? ago(demo.daysAgo - 1) : null,
        reviewed ? ago(demo.daysAgo - 1) : null,
        reviewed && category.legal_framework === "ley_karin" ? ago(demo.daysAgo - 2) : null,
        proposed ? "substantiated" : null,
        demo.proposal ?? null,
        proposed ? ago(demo.status === "closed" ? 40 : 4) : null,
        proposed ? (investigator?.id ?? null) : null,
      ],
    );
    const caseId = res.rows[0]!.id;
    if (demo.reporter?.rut) await pool.query("UPDATE cases SET reporter_rut = $2 WHERE id = $1", [caseId, demo.reporter.rut]);
    // Ley Karin en investigación: investigación interna ya definida, con aviso a la DT y derivación al organismo
    // administrador registrados.
    if (category.legal_framework === "ley_karin" && demo.status === "investigating") {
      await pool.query("UPDATE cases SET route = 'internal', company_relation = 'same' WHERE id = $1", [caseId]);
      await pool.query(
        `INSERT INTO case_milestones (case_id, key, done_at, detail) VALUES
           ($1, 'oal_referral', $2, 'Derivación a la mutualidad para atención psicológica temprana.'),
           ($1, 'dt_start_notice', $3, 'Aviso de inicio de investigación ingresado en el portal de la DT.')`,
        [caseId, ago(demo.daysAgo - 1), ago(demo.daysAgo - 2)],
      );
    }
    for (const [daysAgo, actor, action, detail] of demo.events) {
      await pool.query(
        "INSERT INTO case_events (case_id, occurred_at, actor_label, action, detail) VALUES ($1, $2, $3, $4, $5)",
        [caseId, ago(daysAgo), actor, action, detail ?? null],
      );
    }
    for (const [daysAgo, sender, body] of demo.messages ?? []) {
      await pool.query(
        "INSERT INTO case_messages (case_id, sender, body, created_at, read_at) VALUES ($1, $2, $3, $4, $5)",
        // El último mensaje del denunciante queda sin leer para mostrar la bandeja.
        [caseId, sender, body, ago(daysAgo), sender === "reporter" && daysAgo <= 2 ? null : ago(daysAgo)],
      );
    }
    created++;
  }
  return created;
}
