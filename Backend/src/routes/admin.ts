import { type Request, Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireRole } from "../middleware/auth.js";
import { findAccount, globalAccounts, setAccountActive, setPassword } from "../services/accounts.js";
import { audit, listAuditEvents } from "../services/audit.js";
import { hashPassword } from "../services/auth.js";
import { resetMfa } from "../services/mfa.js";
import { generateTemporaryPassword } from "../services/passwords.js";
import { getOverview, getSystemStatus } from "../services/system.js";
import { createTeamMember, getTeamMember, listTeam } from "../services/team.js";
import {
  SLUG_REGEX,
  applyDefaultAreas,
  type Tenant,
  countActiveClientAdmins,
  createTenant,
  getClientAdmin,
  getTenantOr404,
  insertClientAdmin,
  listClientAdmins,
  listTenants,
  setTenantPlan,
  setTenantStatus,
  tenantAccounts,
  updateTenantProfile,
} from "../services/tenants.js";
import {
  PLAN_FEATURES,
  PLAN_FRAMEWORKS,
  type Plan,
  createPlan,
  deletePlan,
  getPlan,
  listPlans,
  updatePlan,
} from "../services/plans.js";
import { authFlowRouter } from "./auth-flow.js";
import { mailRouter } from "./mail.js";

/** Rutas del global_admin (equipo BeeHives): /api/admin/... */
export const adminRouter = Router();

/* ------------------------------------------------------------------ Validación */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((v) => v || null)
    .nullable()
    .optional();

const profileSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120).optional(),
  legalName: optionalText(200),
  taxId: optionalText(30),
  contactName: optionalText(120),
  contactEmail: z
    .union([z.literal(""), z.string().trim().toLowerCase().email("Email inválido")])
    .transform((v) => v || null)
    .nullable()
    .optional(),
  contactPhone: optionalText(40),
  notes: optionalText(2000),
});

const newAccountSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120),
  email: z.string().trim().toLowerCase().email("Email inválido"),
});

const createTenantSchema = profileSchema.extend({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_REGEX, "Solo minúsculas, números y guiones (2-40), sin guion al inicio o final"),
  planId: z.uuid("Selecciona un plan"),
  admin: newAccountSchema,
});

const updateTenantSchema = profileSchema.extend({
  status: z.enum(["active", "suspended"]).optional(),
  planId: z.uuid("Selecciona un plan").optional(),
});

const limitSchema = z
  .number()
  .int("Debe ser un número entero")
  .min(1, "Mínimo 1")
  .max(100_000)
  .nullable();

const planSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(60),
  description: optionalText(300).transform((v) => v ?? null),
  frameworks: z.array(z.enum(PLAN_FRAMEWORKS)).min(1, "Incluye al menos un marco legal").transform((v) => [...new Set(v)]),
  features: z.array(z.enum(PLAN_FEATURES)).transform((v) => [...new Set(v)]),
  maxUsers: limitSchema,
  maxAreas: limitSchema,
  maxCategories: limitSchema,
  isActive: z.boolean().optional(),
});
const activeSchema = z.object({ isActive: z.boolean() });
const uuid = (value: unknown, what: string) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(404, `${what} no encontrado`);
  return parsed.data;
};

const publicTenant = (t: Tenant) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  status: t.status,
  planId: t.plan_id,
  dbName: t.db_name,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  legalName: t.legal_name,
  taxId: t.tax_id,
  contactName: t.contact_name,
  contactEmail: t.contact_email,
  contactPhone: t.contact_phone,
  notes: t.notes,
});

/* ------------------------------------------------------------------ Sesión */

adminRouter.use(
  "/auth",
  authFlowRouter({
    roles: ["global_admin"],
    store: () => globalAccounts,
    scope: () => "global",
    organization: () => "Consola de administración",
    loginPath: () => "/admin/login",
  }),
);

// /auth/me responde aunque haya un cambio de contraseña pendiente, para que el frontend lo sepa.
adminRouter.get("/auth/me", requireRole("global_admin", { allowPendingPasswordChange: true }), async (req, res) => {
  const account = (await findAccount(globalAccounts, req.actor!.id))!;
  res.json({
    user: {
      id: account.id,
      name: account.name,
      email: account.email,
      role: "global_admin",
      mustChangePassword: account.must_change_password,
      mfaEnabledAt: account.totp_enabled_at,
      recoveryCodesRemaining: account.recovery_codes.length,
      passwordChangedAt: account.password_changed_at,
    },
  });
});

adminRouter.use(requireRole("global_admin"));

// Correo saliente por defecto de la plataforma (lo usan las empresas que no configuran el suyo).
adminRouter.use("/mail", mailRouter({ scope: () => ({ kind: "platform" }), organization: () => "Consola de administración" }));

/* ------------------------------------------------------------------ Resumen, sistema y auditoría */

adminRouter.get("/overview", async (_req, res) => {
  res.json(await getOverview());
});

adminRouter.get("/system", async (_req, res) => {
  res.json(await getSystemStatus());
});

adminRouter.get("/audit", async (req, res) => {
  const q = z
    .object({
      action: z.string().max(60).optional(),
      tenant: z.string().max(60).optional(),
      q: z.string().max(120).optional(),
      before: z.string().regex(/^\d+$/).optional(),
      limit: z.coerce.number().int().optional(),
    })
    .parse(req.query);
  res.json(await listAuditEvents(q));
});

/* ------------------------------------------------------------------ Empresas */

adminRouter.get("/tenants", async (_req, res) => {
  res.json({ tenants: (await listTenants()).map(publicTenant) });
});

adminRouter.post("/tenants", async (req, res) => {
  const input = createTenantSchema.parse(req.body);
  const { tenant, credentials } = await createTenant(input);
  await audit(req, {
    action: "tenant.created",
    targetType: "tenant",
    targetId: tenant.id,
    targetLabel: tenant.name,
    tenantSlug: tenant.slug,
    metadata: { initialAdmin: credentials.email },
  });
  res.status(201).json({ tenant: publicTenant(tenant), credentials });
});

adminRouter.get("/tenants/:slug", async (req, res) => {
  res.json({ tenant: publicTenant(await getTenantOr404(req.params.slug)) });
});

adminRouter.patch("/tenants/:slug", async (req, res) => {
  const { status, planId, ...profile } = updateTenantSchema.parse(req.body);
  let tenant = await getTenantOr404(req.params.slug);
  const target = { targetType: "tenant" as const, targetId: tenant.id, tenantSlug: tenant.slug };

  if (planId) {
    const before = tenant.plan_id;
    const result = await setTenantPlan(tenant.slug, planId);
    tenant = result.tenant;
    if (result.changed) {
      const [from, to] = await Promise.all([getPlan(before), getPlan(planId)]);
      await audit(req, {
        action: "tenant.plan_changed",
        ...target,
        targetLabel: tenant.name,
        metadata: { from: from.name, to: to.name },
      });
    }
  }

  if (Object.keys(profile).length) {
    const result = await updateTenantProfile(tenant.slug, profile);
    tenant = result.tenant;
    if (result.changed.length) {
      await audit(req, { action: "tenant.updated", ...target, targetLabel: tenant.name, metadata: { fields: result.changed } });
    }
  }
  if (status && status !== tenant.status) {
    tenant = await setTenantStatus(tenant.slug, status);
    await audit(req, {
      action: status === "suspended" ? "tenant.suspended" : "tenant.reactivated",
      ...target,
      targetLabel: tenant.name,
    });
  }
  res.json({ tenant: publicTenant(tenant) });
});

/* ------------------------------------------------------------------ Planes */

const publicPlan = (p: Plan & { tenants?: number }) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  frameworks: p.frameworks,
  features: p.features,
  maxUsers: p.max_users,
  maxAreas: p.max_areas,
  maxCategories: p.max_categories,
  isActive: p.is_active,
  tenants: p.tenants ?? 0,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

adminRouter.get("/plans", async (_req, res) => {
  res.json({ plans: (await listPlans()).map(publicPlan) });
});

adminRouter.post("/plans", async (req, res) => {
  const plan = await createPlan(planSchema.parse(req.body));
  await audit(req, { action: "plan.created", targetType: "plan", targetId: plan.id, targetLabel: plan.name });
  res.status(201).json({ plan: publicPlan(plan) });
});

adminRouter.put("/plans/:id", async (req, res) => {
  const id = uuid(req.params.id, "Plan");
  const before = await getPlan(id);
  const plan = await updatePlan(id, planSchema.parse(req.body));
  // Leyes agregadas al plan: sus empresas reciben las áreas por defecto de esas categorías (ver applyDefaultAreas).
  const added = plan.frameworks.filter((f) => !before.frameworks.includes(f));
  if (added.length) {
    for (const tenant of (await listTenants()).filter((t) => t.plan_id === id && t.status !== "provisioning")) {
      await applyDefaultAreas(tenant, added);
    }
  }
  await audit(req, { action: "plan.updated", targetType: "plan", targetId: plan.id, targetLabel: plan.name });
  res.json({ plan: publicPlan(plan) });
});

adminRouter.delete("/plans/:id", async (req, res) => {
  const plan = await deletePlan(uuid(req.params.id, "Plan"));
  await audit(req, { action: "plan.deleted", targetType: "plan", targetId: plan.id, targetLabel: plan.name });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ Administradores de una empresa */

async function clientAdminTarget(req: Request) {
  const tenant = await getTenantOr404(String(req.params.slug));
  const admin = await getClientAdmin(tenant, uuid(req.params.id, "Administrador"));
  const auditTarget = {
    targetType: "client_admin" as const,
    targetId: admin.id,
    targetLabel: admin.email,
    tenantSlug: tenant.slug,
  };
  return { tenant, admin, auditTarget };
}

adminRouter.get("/tenants/:slug/admins", async (req, res) => {
  const tenant = await getTenantOr404(req.params.slug);
  res.json({ admins: await listClientAdmins(tenant) });
});

adminRouter.post("/tenants/:slug/admins", async (req, res) => {
  const tenant = await getTenantOr404(req.params.slug);
  const { admin, credentials } = await insertClientAdmin(tenant, newAccountSchema.parse(req.body));
  await audit(req, {
    action: "client_admin.created",
    targetType: "client_admin",
    targetId: admin.id,
    targetLabel: admin.email,
    tenantSlug: tenant.slug,
  });
  res.status(201).json({ admin, credentials });
});

adminRouter.patch("/tenants/:slug/admins/:id", async (req, res) => {
  const { isActive } = activeSchema.parse(req.body);
  const { tenant, admin, auditTarget } = await clientAdminTarget(req);
  if (admin.is_active === isActive) return void res.json({ admin });

  if (!isActive && (await countActiveClientAdmins(tenant)) <= 1) {
    throw new HttpError(409, "La empresa debe tener al menos un administrador activo");
  }
  await setAccountActive(tenantAccounts(tenant), admin.id, isActive);
  await audit(req, { action: isActive ? "client_admin.reactivated" : "client_admin.deactivated", ...auditTarget });
  res.json({ admin: await getClientAdmin(tenant, admin.id) });
});

adminRouter.post("/tenants/:slug/admins/:id/reset-password", async (req, res) => {
  const { tenant, admin, auditTarget } = await clientAdminTarget(req);
  const temporaryPassword = generateTemporaryPassword();
  await setPassword(tenantAccounts(tenant), admin.id, await hashPassword(temporaryPassword), true);
  await audit(req, { action: "client_admin.password_reset", ...auditTarget });
  res.json({ credentials: { email: admin.email, temporaryPassword } });
});

/** Para un client_admin que perdió su teléfono: en su próximo login configurará el 2FA de nuevo. */
adminRouter.post("/tenants/:slug/admins/:id/reset-mfa", async (req, res) => {
  const { tenant, admin, auditTarget } = await clientAdminTarget(req);
  await resetMfa(tenantAccounts(tenant), admin.id);
  await audit(req, { action: "client_admin.mfa_reset", ...auditTarget });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ Equipo BeeHives */

/** Acciones sobre otro miembro del equipo. Las propias se hacen desde "Mi cuenta". */
async function teamTarget(req: Request) {
  const member = await getTeamMember(uuid(req.params.id, "Usuario"));
  if (member.id === req.actor!.id) {
    throw new HttpError(409, "Para cambiar tu propia cuenta usa la sección Mi cuenta");
  }
  const auditTarget = { targetType: "global_admin" as const, targetId: member.id, targetLabel: member.email };
  return { member, auditTarget };
}

adminRouter.get("/team", async (_req, res) => {
  res.json({ members: await listTeam() });
});

adminRouter.post("/team", async (req, res) => {
  const { member, credentials } = await createTeamMember(newAccountSchema.parse(req.body));
  await audit(req, {
    action: "global_admin.created",
    targetType: "global_admin",
    targetId: member.id,
    targetLabel: member.email,
  });
  res.status(201).json({ member, credentials });
});

adminRouter.patch("/team/:id", async (req, res) => {
  const { isActive } = activeSchema.parse(req.body);
  const { member, auditTarget } = await teamTarget(req);
  if (member.is_active !== isActive) {
    await setAccountActive(globalAccounts, member.id, isActive);
    await audit(req, { action: isActive ? "global_admin.reactivated" : "global_admin.deactivated", ...auditTarget });
  }
  res.json({ member: await getTeamMember(member.id) });
});

adminRouter.post("/team/:id/reset-password", async (req, res) => {
  const { member, auditTarget } = await teamTarget(req);
  const temporaryPassword = generateTemporaryPassword();
  await setPassword(globalAccounts, member.id, await hashPassword(temporaryPassword), true);
  await audit(req, { action: "global_admin.password_reset", ...auditTarget });
  res.json({ credentials: { email: member.email, temporaryPassword } });
});

adminRouter.post("/team/:id/reset-mfa", async (req, res) => {
  const { member, auditTarget } = await teamTarget(req);
  await resetMfa(globalAccounts, member.id);
  await audit(req, { action: "global_admin.mfa_reset", ...auditTarget });
  res.json({ ok: true });
});
