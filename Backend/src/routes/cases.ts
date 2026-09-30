import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireRole } from "../middleware/auth.js";
import { getAlerts } from "../services/alerts.js";
import { audit, listAuditEvents } from "../services/audit.js";
import {
  CASE_ACTIONS,
  CASE_ROLES,
  type CaseRole,
  applyCaseAction,
  getChannelResources,
  getVisibleCase,
  getVisibleCaseFile,
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

/** Alertas de plazos vencidos o por vencer a cargo de la persona (campana del panel). */
casesRouter.get("/alerts", async (req, res) => {
  res.json(await getAlerts(req.tenant!, req.actor!.id, roleOf(req.actor!.role)));
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

/**
 * Descarga de una evidencia del denunciante. Siempre como adjunto (nunca se muestra dentro de la app) y con el tipo
 * validado al subirla; cada descarga queda en la auditoría.
 */
casesRouter.get("/:id/files/:fileId", async (req, res) => {
  const id = caseId(req.params.id);
  const fileId = z.uuid().safeParse(req.params.fileId);
  if (!fileId.success) throw new HttpError(404, "Archivo no encontrado");
  const { code, file, body } = await getVisibleCaseFile(req.tenant!, req.actor!.id, roleOf(req.actor!.role), id, fileId.data);
  await audit(req, {
    action: "case.file_downloaded",
    targetType: "case",
    targetId: id,
    targetLabel: code,
    tenantSlug: req.tenant!.slug,
  });
  const ascii = file.file_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.set({
    "Content-Type": file.mime,
    "Content-Length": String(body.length),
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(body);
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
