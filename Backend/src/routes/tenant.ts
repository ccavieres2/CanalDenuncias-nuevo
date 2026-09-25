import { Router } from "express";
import { HttpError } from "../errors.js";
import { requireRole } from "../middleware/auth.js";
import { findAccount } from "../services/accounts.js";
import { TENANT_ROLES } from "../services/auth.js";
import { effectiveCategories, getUser, hasScopedRole, listCategories } from "../services/channel.js";
import { publicBranding } from "../services/branding.js";
import { findTenantBySlug, tenantAccounts } from "../services/tenants.js";
import { authFlowRouter } from "./auth-flow.js";
import { casesRouter } from "./cases.js";
import { channelRouter } from "./channel.js";
import { publicRouter } from "./public.js";

/** Rutas de una empresa: /api/t/:slug/... Cada request usa la base de ese tenant. */
export const tenantRouter = Router({ mergeParams: true });

// Resuelve el tenant por slug. Empresas suspendidas o inexistentes responden 404 igual.
tenantRouter.use(async (req, _res, next) => {
  const tenant = await findTenantBySlug(String(req.params.slug ?? ""));
  if (!tenant || tenant.status !== "active") throw new HttpError(404, "Empresa no encontrada");
  req.tenant = tenant;
  next();
});

/** Info pública para mostrar en la pantalla de login. */
tenantRouter.get("/", async (req, res) => {
  res.json({ tenant: { name: req.tenant!.name, slug: req.tenant!.slug, branding: await publicBranding(req.tenant!) } });
});

tenantRouter.use(
  "/auth",
  authFlowRouter({
    roles: TENANT_ROLES,
    store: (req) => tenantAccounts(req.tenant!),
    scope: (req) => req.tenant!.slug,
  }),
);

// Responde aunque haya un cambio de contraseña pendiente, para que el frontend lo sepa.
tenantRouter.get("/auth/me", requireRole(TENANT_ROLES, { allowPendingPasswordChange: true }), async (req, res) => {
  const tenant = req.tenant!;
  const [account, user, categories] = await Promise.all([
    findAccount(tenantAccounts(tenant), req.actor!.id),
    getUser(tenant, req.actor!.id),
    listCategories(tenant),
  ]);
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      // Rol con el que está trabajando en esta sesión.
      activeRole: req.actor!.role,
      area: user.area,
      // Categorías que efectivamente ve (según asignación y área autorizada); null si no gestiona denuncias.
      categories: hasScopedRole(user.roles)
        ? effectiveCategories(user, categories.filter((c) => c.is_active)).map((c) => c.name)
        : null,
      mustChangePassword: account!.must_change_password,
      mfaEnabledAt: account!.totp_enabled_at,
      recoveryCodesRemaining: account!.recovery_codes.length,
      passwordChangedAt: account!.password_changed_at,
    },
    tenant: { name: tenant.name, slug: tenant.slug, branding: await publicBranding(tenant) },
  });
});

tenantRouter.use("/console", channelRouter);
tenantRouter.use("/cases", casesRouter);
// Portal público del denunciante (sin sesión).
tenantRouter.use("/public", publicRouter);
