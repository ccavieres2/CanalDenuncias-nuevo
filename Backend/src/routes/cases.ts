import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireRole } from "../middleware/auth.js";
import { audit, listAuditEvents } from "../services/audit.js";
import {
  CASE_ACTIONS,
  CASE_ROLES,
  type CaseRole,
  applyCaseAction,
  getChannelResources,
  getVisibleCase,
  listConversations,
  listDeadlines,
  listVisibleCases,
  registerCase,
  registerOptions,
} from "../services/cases.js";

/**
 * Denuncias para los roles que las gestionan: /api/t/:slug/cases/...
 * Lo que se ve y lo que se puede hacer depende del rol activo de la sesión.
 */
export const casesRouter = Router({ mergeParams: true });
casesRouter.use(requireRole(CASE_ROLES));

const roleOf = (role: string) => role as CaseRole;

const caseId = (raw: unknown) => {
  const id = z.uuid().safeParse(raw);
  if (!id.success) throw new HttpError(404, "Denuncia no encontrada");
  return id.data;
};

casesRouter.get("/", async (req, res) => {
  res.json(await listVisibleCases(req.tenant!, req.actor!.id, roleOf(req.actor!.role)));
});

casesRouter.get("/register-options", requireRole("case_manager"), async (req, res) => {
  res.json(await registerOptions(req.tenant!, req.actor!.id));
});

/** El gestor registra una denuncia recibida por otra vía (directa a la empresa o notificada por la DT). */
casesRouter.post("/", requireRole("case_manager"), async (req, res) => {
  const result = await registerCase(req.tenant!, req.actor!.id, req.body);
  await audit(req, {
    action: "case.registered",
    targetType: "case",
    targetId: result.id,
    targetLabel: result.code,
    tenantSlug: req.tenant!.slug,
  });
  res.status(201).json(result);
});

/** Agenda: plazos pendientes de las denuncias abiertas que el rol puede ver. */
casesRouter.get("/deadlines", async (req, res) => {
  res.json({ deadlines: await listDeadlines(req.tenant!, req.actor!.id, roleOf(req.actor!.role)) });
});

/** Bandeja de conversaciones con denunciantes (gestor e investigador). */
casesRouter.get("/messages", requireRole(["case_manager", "investigator"]), async (req, res) => {
  res.json({ conversations: await listConversations(req.tenant!, req.actor!.id, roleOf(req.actor!.role)) });
});

/** Política y reglas del canal, para consulta de quienes gestionan denuncias. */
casesRouter.get("/resources", async (req, res) => {
  res.json(await getChannelResources(req.tenant!));
});

/** Registro de accesos y acciones sobre denuncias: solo para el auditor. */
casesRouter.get("/access-log", requireRole("auditor"), async (req, res) => {
  const q = z
    .object({ before: z.string().regex(/^\d+$/).optional(), q: z.string().max(120).optional() })
    .parse(req.query);
  res.json(await listAuditEvents({ ...q, action: "case", tenant: req.tenant!.slug, limit: 50 }));
});

casesRouter.get("/:id", async (req, res) => {
  const result = await getVisibleCase(req.tenant!, req.actor!.id, roleOf(req.actor!.role), caseId(req.params.id));
  // Cada acceso a una denuncia queda registrado.
  await audit(req, {
    action: "case.viewed",
    targetType: "case",
    targetId: result.case.id,
    targetLabel: result.case.code,
    tenantSlug: req.tenant!.slug,
  });
  res.json(result);
});

/** Acciones del flujo (asignar, diligencias, proponer, aprobar, mensajes…). El servicio valida rol y estado. */
casesRouter.post("/:id/actions/:action", async (req, res) => {
  const id = caseId(req.params.id);
  const action = z.enum(CASE_ACTIONS).safeParse(req.params.action);
  if (!action.success) throw new HttpError(404, "Acción no válida");
  const result = await applyCaseAction(req.tenant!, req.actor!.id, roleOf(req.actor!.role), id, action.data, req.body);
  // En la auditoría solo queda qué se hizo y sobre qué caso; nunca el contenido.
  await audit(req, {
    action: `case.${action.data}`,
    targetType: "case",
    targetId: id,
    targetLabel: result.code,
    tenantSlug: req.tenant!.slug,
  });
  res.json(result);
});
