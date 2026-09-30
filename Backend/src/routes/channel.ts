import { type Request, Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireRole } from "../middleware/auth.js";
import { setAccountActive, setPassword } from "../services/accounts.js";
import { type AuditInput, audit, listAuditEvents } from "../services/audit.js";
import { TENANT_ROLES, hashPassword } from "../services/auth.js";
import { brandingForAdmin, getBranding, setLogo, setPrimaryColor } from "../services/branding.js";
import { clearDemoCases, countDemoCases, seedDemoCases } from "../services/cases.js";
import {
  type ChannelMode,
  countActiveAdmins,
  hasScopedRole,
  roleCombinationError,
  createArea,
  createCategory,
  createUser,
  deleteArea,
  getChannelOverview,
  getSettings,
  getUser,
  listAreas,
  listCategories,
  listCategoriesWithCoverage,
  listUsers,
  renameArea,
  setAreaCategories,
  saveSetting,
  updateCategory,
  updateUser,
} from "../services/channel.js";
import { resetMfa } from "../services/mfa.js";
import { generateTemporaryPassword } from "../services/passwords.js";
import { FLOW_FRAMEWORKS, DEFAULT_FLOW, flowConfigSchema, getFlowsOverview, isFlowFramework, saveTemplate } from "../services/flows.js";
import { type Tenant, tenantAccounts } from "../services/tenants.js";
import { hasFramework, planOf, requireBelowLimit, requireFeature, requireFramework } from "../services/plans.js";
import { mailRouter } from "./mail.js";

/**
 * Panel del client_admin: /api/t/:slug/console/...
 * Configura el canal (usuarios, categorías, portal, reglas). No da acceso a denuncias.
 */
export const channelRouter = Router({ mergeParams: true });
channelRouter.use(requireRole("client_admin"));

// Correo saliente propio de la empresa (opcional; si no tiene, usa el de la plataforma).
// Configurar un SMTP propio exige el módulo en el plan. Quitarlo (DELETE) siempre se permite.
channelRouter.use("/mail", async (req, _res, next) => {
  if (req.method === "PUT" || req.method === "POST") await requireFeature(req.tenant!, "custom_smtp");
  next();
});
channelRouter.use(
  "/mail",
  mailRouter({
    scope: (req) => ({ kind: "tenant", tenant: req.tenant! }),
    organization: (req) => req.tenant!.name,
    tenantSlug: (req) => req.tenant!.slug,
  }),
);

/* ------------------------------------------------------------------ Validación */

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((v) => v || null)
    .nullable();

const scopeFields = {
  allCategories: z.boolean(),
  categoryIds: z.array(z.uuid()).max(200),
};

const areaIdSchema = z.uuid({ message: "Selecciona un área" });

const rolesSchema = z
  .array(z.enum(TENANT_ROLES, { message: "Rol inválido" }))
  .min(1, "Selecciona al menos un rol")
  .max(TENANT_ROLES.length);

const newUserSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120),
  email: z.string().trim().toLowerCase().email("Email inválido"),
  roles: rolesSchema,
  areaId: areaIdSchema,
  allCategories: scopeFields.allCategories.default(true),
  categoryIds: scopeFields.categoryIds.default([]),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120).optional(),
  roles: rolesSchema.optional(),
  areaId: areaIdSchema.optional(),
  allCategories: scopeFields.allCategories.optional(),
  categoryIds: scopeFields.categoryIds.optional(),
  isActive: z.boolean().optional(),
});

const categorySchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(80),
  description: nullableText(400).default(null),
  legalFramework: z.enum(["ley_karin", "ley_20393", "ley_21719", "internal"]),
  areaIds: z.array(z.uuid()).max(100).default([]),
});

// Edición parcial: sin valores por defecto, para no pisar campos que no se enviaron.
const categoryPatchSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(80).optional(),
  description: nullableText(400).optional(),
  legalFramework: z.enum(["ley_karin", "ley_20393", "ley_21719", "internal"]).optional(),
  areaIds: z.array(z.uuid()).max(100).optional(),
  isActive: z.boolean().optional(),
});

const areaSchema = z.object({ name: z.string().trim().min(2, "Mínimo 2 caracteres").max(80) });

const portalSchema = z.object({
  title: z.string().trim().min(3, "Mínimo 3 caracteres").max(80),
  welcome: z.string().trim().max(1500, "Máximo 1500 caracteres"),
  policy: z.string().trim().max(20000, "Máximo 20.000 caracteres"),
  allowAnonymous: z.boolean(),
  contactEmail: z
    .union([z.literal(""), z.string().trim().toLowerCase().email("Email inválido")])
    .transform((v) => v || null)
    .nullable(),
  reportEmail: z
    .union([z.literal(""), z.string().trim().toLowerCase().email("Email inválido")])
    .transform((v) => v || null)
    .nullable()
    .default(null),
  phone: z
    .string()
    .trim()
    .max(40, "Máximo 40 caracteres")
    .transform((v) => v || null)
    .nullable()
    .default(null),
  inPerson: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres")
    .transform((v) => v || null)
    .nullable()
    .default(null),
});

const caseRulesSchema = z.object({
  mode: z.enum(["simplified", "complete"]),
  retentionMonths: z.number().int().min(12, "Mínimo 12 meses").max(240, "Máximo 240 meses"),
  conflictPlan: z.object({
    substituteUserId: z.uuid().nullable(),
    externalContact: z
      .string()
      .trim()
      .max(300, "Máximo 300 caracteres")
      .transform((v) => v || null)
      .nullable(),
  }),
});

const idParam = (req: Request, what: string) => {
  const parsed = z.uuid().safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, `${what} no encontrado`);
  return parsed.data;
};

const auditFor = (req: Request, input: Omit<AuditInput, "tenantSlug">) =>
  audit(req, { ...input, tenantSlug: req.tenant!.slug });

/* ------------------------------------------------------------------ Plan */

const countActiveUsers = async (tenant: Tenant) => (await listUsers(tenant)).filter((u) => u.is_active).length;
const countActiveCategories = async (tenant: Tenant) => (await listCategories(tenant)).filter((c) => c.is_active).length;

/** Flujos editables, solo de los marcos que incluye el plan. */
async function flowsForPlan(tenant: Tenant) {
  const [plan, overview] = await Promise.all([planOf(tenant), getFlowsOverview(tenant)]);
  return { ...overview, flows: overview.flows.filter((f) => hasFramework(plan, f.framework)) };
}

/* ------------------------------------------------------------------ Resumen */

channelRouter.get("/overview", async (req, res) => {
  const [overview, demoCases] = await Promise.all([getChannelOverview(req.tenant!), countDemoCases(req.tenant!)]);
  res.json({ ...overview, demoCases });
});

/* ------------------------------------------------------------------ Denuncias de ejemplo */

// Para conocer las vistas de cada rol antes de habilitar el canal. El administrador no las ve:
// solo las carga o las elimina.
channelRouter.post("/demo-cases", async (req, res) => {
  if (await countDemoCases(req.tenant!)) throw new HttpError(409, "Las denuncias de ejemplo ya están cargadas");
  const created = await seedDemoCases(req.tenant!);
  await auditFor(req, { action: "cases.demo_loaded", metadata: { count: created } });
  res.status(201).json({ created });
});

channelRouter.delete("/demo-cases", async (req, res) => {
  const deleted = await clearDemoCases(req.tenant!);
  await auditFor(req, { action: "cases.demo_cleared", metadata: { count: deleted } });
  res.json({ deleted });
});

/* ------------------------------------------------------------------ Usuarios */

/** Usuario objetivo de una acción. Las acciones sobre la propia cuenta se hacen en "Mi cuenta". */
async function targetUser(req: Request) {
  const user = await getUser(req.tenant!, idParam(req, "Usuario"));
  const self = user.id === req.actor!.id;
  return { user, self, auditTarget: { targetType: "user" as const, targetId: user.id, targetLabel: user.email } };
}

/** Valida la combinación de roles según la modalidad de la empresa. */
async function ensureRoleCombination(req: Request, roles: readonly (typeof TENANT_ROLES)[number][]) {
  const { caseRules } = await getSettings(req.tenant!);
  const error = roleCombinationError(roles, caseRules.mode);
  if (error) throw new HttpError(400, error, "role_combination");
}

/** Impide dejar la empresa sin ningún administrador del canal activo. */
async function ensureAnotherAdmin(req: Request) {
  if ((await countActiveAdmins(req.tenant!)) <= 1) {
    throw new HttpError(409, "El canal debe tener al menos un administrador activo");
  }
}

channelRouter.get("/users", async (req, res) => {
  res.json({ users: await listUsers(req.tenant!) });
});

channelRouter.post("/users", async (req, res) => {
  const input = newUserSchema.parse(req.body);
  await ensureRoleCombination(req, input.roles);
  await requireBelowLimit(req.tenant!, "max_users", await countActiveUsers(req.tenant!));
  const { user, credentials } = await createUser(req.tenant!, input);
  await auditFor(req, {
    action: "user.created",
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
    metadata: { roles: user.roles },
  });
  res.status(201).json({ user, credentials });
});

channelRouter.patch("/users/:id", async (req, res) => {
  const { isActive, ...changes } = updateUserSchema.parse(req.body);
  const { user, self, auditTarget } = await targetUser(req);
  const tenant = req.tenant!;

  if (self && isActive === false) throw new HttpError(409, "No puedes desactivarte a ti mismo");
  if (self && changes.roles && !changes.roles.includes("client_admin")) {
    throw new HttpError(409, "No puedes quitarte el rol de administrador del canal");
  }
  if (changes.roles) await ensureRoleCombination(req, changes.roles);
  const losesAdmin =
    user.roles.includes("client_admin") &&
    user.is_active &&
    (isActive === false || (changes.roles !== undefined && !changes.roles.includes("client_admin")));
  if (losesAdmin) await ensureAnotherAdmin(req);
  if (isActive === true && !user.is_active) {
    await requireBelowLimit(tenant, "max_users", await countActiveUsers(tenant));
  }

  const changed = await updateUser(tenant, user.id, changes);
  if (changed.length) {
    await auditFor(req, {
      action: "user.updated",
      ...auditTarget,
      metadata: { fields: changed, ...(changed.includes("roles") ? { from: user.roles, to: changes.roles } : {}) },
    });
  }
  if (isActive !== undefined && isActive !== user.is_active) {
    await setAccountActive(tenantAccounts(tenant), user.id, isActive);
    await auditFor(req, { action: isActive ? "user.reactivated" : "user.deactivated", ...auditTarget });
  }
  res.json({ user: await getUser(tenant, user.id) });
});

channelRouter.post("/users/:id/reset-password", async (req, res) => {
  const { user, self, auditTarget } = await targetUser(req);
  if (self) throw new HttpError(409, "Para cambiar tu contraseña usa la sección Mi cuenta");
  const temporaryPassword = generateTemporaryPassword();
  await setPassword(tenantAccounts(req.tenant!), user.id, await hashPassword(temporaryPassword), true);
  await auditFor(req, { action: "user.password_reset", ...auditTarget });
  res.json({ credentials: { email: user.email, temporaryPassword } });
});

channelRouter.post("/users/:id/reset-mfa", async (req, res) => {
  const { user, self, auditTarget } = await targetUser(req);
  if (self) throw new HttpError(409, "No puedes restablecer tu propia verificación en dos pasos");
  await resetMfa(tenantAccounts(req.tenant!), user.id);
  await auditFor(req, { action: "user.mfa_reset", ...auditTarget });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ Áreas */

channelRouter.get("/areas", async (req, res) => {
  res.json({ areas: await listAreas(req.tenant!) });
});

channelRouter.post("/areas", async (req, res) => {
  await requireBelowLimit(req.tenant!, "max_areas", (await listAreas(req.tenant!)).length);
  const area = await createArea(req.tenant!, areaSchema.parse(req.body).name);
  await auditFor(req, { action: "area.created", targetType: "area", targetId: area.id, targetLabel: area.name });
  res.status(201).json({ area });
});

channelRouter.patch("/areas/:id", async (req, res) => {
  const id = idParam(req, "Área");
  const { before, after } = await renameArea(req.tenant!, id, areaSchema.parse(req.body).name);
  if (before !== after) {
    await auditFor(req, { action: "area.updated", targetType: "area", targetId: id, targetLabel: after, metadata: { from: before } });
  }
  res.json({ ok: true });
});

/** Categorías restringidas que el área puede tener a cargo (vista inversa de Categorías → áreas). */
channelRouter.put("/areas/:id/categories", async (req, res) => {
  const id = idParam(req, "Área");
  const { categoryIds } = z.object({ categoryIds: z.array(z.uuid()).max(200) }).parse(req.body);
  const { area, added, removed } = await setAreaCategories(req.tenant!, id, categoryIds);
  if (added.length || removed.length) {
    await auditFor(req, {
      action: "area.categories_updated",
      targetType: "area",
      targetId: id,
      targetLabel: area,
      metadata: { added, removed },
    });
  }
  res.json({ added, removed });
});

channelRouter.delete("/areas/:id", async (req, res) => {
  const id = idParam(req, "Área");
  const name = await deleteArea(req.tenant!, id);
  await auditFor(req, { action: "area.deleted", targetType: "area", targetId: id, targetLabel: name });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ Categorías */

channelRouter.get("/categories", async (req, res) => {
  // Las categorías de marcos que el plan no incluye no se muestran (se conservan en la base).
  const [plan, categories] = await Promise.all([planOf(req.tenant!), listCategoriesWithCoverage(req.tenant!)]);
  res.json({ categories: categories.filter((c) => hasFramework(plan, c.legal_framework)) });
});

channelRouter.post("/categories", async (req, res) => {
  const input = categorySchema.parse(req.body);
  await requireFramework(req.tenant!, input.legalFramework);
  await requireBelowLimit(req.tenant!, "max_categories", await countActiveCategories(req.tenant!));
  const category = await createCategory(req.tenant!, input);
  await auditFor(req, { action: "category.created", targetType: "category", targetId: category.id, targetLabel: category.name });
  res.status(201).json({ category });
});

channelRouter.patch("/categories/:id", async (req, res) => {
  const input = categoryPatchSchema.parse(req.body);
  const id = idParam(req, "Categoría");
  const current = (await listCategories(req.tenant!)).find((c) => c.id === id);
  if (!current) throw new HttpError(404, "Categoría no encontrada");
  await requireFramework(req.tenant!, input.legalFramework ?? current.legal_framework);
  if (input.isActive === true && !current.is_active) {
    await requireBelowLimit(req.tenant!, "max_categories", await countActiveCategories(req.tenant!));
  }
  const { category, changed } = await updateCategory(req.tenant!, id, input);
  if (changed.length) {
    await auditFor(req, {
      action: "category.updated",
      targetType: "category",
      targetId: category.id,
      targetLabel: category.name,
      metadata: { fields: changed },
    });
  }
  res.json({ category });
});

/* ------------------------------------------------------------------ Ajustes */

channelRouter.get("/settings", async (req, res) => {
  res.json(await getSettings(req.tenant!));
});

channelRouter.put("/settings/portal", async (req, res) => {
  const portal = portalSchema.parse(req.body);
  await saveSetting(req.tenant!, "portal", portal, req.actor!.id);
  await auditFor(req, { action: "settings.updated", targetType: "settings", targetLabel: "Portal del denunciante" });
  res.json({ portal });
});

/* ---------- Flujos de gestión (plantillas de la empresa; Ley Karin no se edita) */

const FLOW_LABEL: Record<string, string> = {
  ley_20393: "Delitos (Ley 20.393)",
  ley_21719: "Datos personales (Ley 21.719)",
  internal: "Normativa interna",
};

channelRouter.get("/flows", async (req, res) => {
  res.json(await flowsForPlan(req.tenant!));
});

channelRouter.put("/flows/:framework", async (req, res) => {
  const framework = String(req.params.framework);
  if (!isFlowFramework(framework)) {
    throw new HttpError(400, `Solo se pueden editar: ${FLOW_FRAMEWORKS.join(", ")}. El procedimiento de Ley Karin lo fija la ley.`);
  }
  // El plan se revisa antes que el contenido: un marco que no incluye no se edita, ni siquiera para volver al recomendado.
  await requireFramework(req.tenant!, framework);
  const body = z
    .object({
      config: flowConfigSchema,
      note: z
        .string()
        .trim()
        .max(300, "Máximo 300 caracteres")
        .nullable()
        .optional()
        .transform((v) => v || null),
      reset: z.boolean().optional(),
    })
    .parse(req.body);
  // Volver al flujo recomendado siempre se permite; editarlo exige el módulo.
  if (!body.reset) await requireFeature(req.tenant!, "custom_flows");
  const config = body.reset ? DEFAULT_FLOW : body.config;
  const note = body.note ?? (body.reset ? "Se restauró el flujo recomendado" : null);
  const version = await saveTemplate(req.tenant!, framework, config, note, req.actor!.id);
  await auditFor(req, {
    action: "flow.updated",
    targetType: "settings",
    targetLabel: `Flujo: ${FLOW_LABEL[framework]} (versión ${version})`,
    metadata: { framework, version, note },
  });
  res.json(await flowsForPlan(req.tenant!));
});

/* ---------- Marca de la empresa (logo y color) */

channelRouter.get("/branding", async (req, res) => {
  res.json({ branding: brandingForAdmin(req.tenant!, await getBranding(req.tenant!)) });
});

channelRouter.put("/branding", async (req, res) => {
  await requireFeature(req.tenant!, "branding");
  const { primaryColor } = z.object({ primaryColor: z.string().trim().nullable() }).parse(req.body);
  const branding = await setPrimaryColor(req.tenant!, primaryColor || null, req.actor!.id);
  await auditFor(req, { action: "settings.updated", targetType: "settings", targetLabel: "Marca: color" });
  res.json({ branding: brandingForAdmin(req.tenant!, branding) });
});

channelRouter.put("/branding/logo", async (req, res) => {
  await requireFeature(req.tenant!, "branding");
  const { dataUrl } = z.object({ dataUrl: z.string().max(450_000) }).parse(req.body);
  const branding = await setLogo(req.tenant!, dataUrl, req.actor!.id);
  await auditFor(req, { action: "settings.updated", targetType: "settings", targetLabel: "Marca: logo" });
  res.json({ branding: brandingForAdmin(req.tenant!, branding) });
});

channelRouter.delete("/branding/logo", async (req, res) => {
  const branding = await setLogo(req.tenant!, null, req.actor!.id);
  await auditFor(req, { action: "settings.updated", targetType: "settings", targetLabel: "Marca: logo quitado" });
  res.json({ branding: brandingForAdmin(req.tenant!, branding) });
});

channelRouter.put("/settings/case-rules", async (req, res) => {
  const caseRules = caseRulesSchema.parse(req.body);
  const users = (await listUsers(req.tenant!)).filter((u) => u.is_active);

  // Pasar a modalidad completa exige que nadie combine roles incompatibles.
  const blocked = users.filter((u) => roleCombinationError(u.roles, caseRules.mode as ChannelMode));
  if (blocked.length) {
    throw new HttpError(
      409,
      `Para usar la modalidad completa, primero separa los roles de: ${blocked.map((u) => u.name).join(", ")}.`,
    );
  }
  const substituteId = caseRules.conflictPlan.substituteUserId;
  if (substituteId && !users.some((u) => u.id === substituteId && hasScopedRole(u.roles))) {
    throw new HttpError(400, "El suplente debe ser un usuario activo con un rol que gestione denuncias");
  }
  await saveSetting(req.tenant!, "case_rules", caseRules, req.actor!.id);
  await auditFor(req, {
    action: "settings.updated",
    targetType: "settings",
    targetLabel: "Reglas de gestión",
    metadata: caseRules,
  });
  res.json({ caseRules });
});

/* ------------------------------------------------------------------ Auditoría */

// Acciones que hace el equipo BeeHives sobre la empresa: se muestran sin datos personales del operador.
const PLATFORM_ACTIONS = /^(tenant|client_admin)\./;

channelRouter.get("/audit", async (req, res) => {
  const q = z
    .object({
      action: z.string().max(60).optional(),
      q: z.string().max(120).optional(),
      before: z.string().regex(/^\d+$/).optional(),
      limit: z.coerce.number().int().optional(),
    })
    .parse(req.query);
  const page = await listAuditEvents({ ...q, tenant: req.tenant!.slug });
  res.json({
    ...page,
    events: page.events.map((e) =>
      PLATFORM_ACTIONS.test(e.action)
        ? { ...e, actor_id: null, actor_email: "Soporte BeeHives", ip: null, user_agent: null }
        : e,
    ),
  });
});
