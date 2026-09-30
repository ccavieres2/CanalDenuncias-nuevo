import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate, useOutletContext, useParams } from "react-router";
import { api } from "../lib/api";
import { brandStyle } from "../lib/branding";
import { CASE_VIEW, type CaseRole } from "../lib/cases";
import type { ChannelContext, ChannelTenant, ChannelUser } from "../lib/channel-context";
import { type PlanFeature, type TenantPlan, planHas } from "../lib/plans";
import { ROLES, ROLE_ORDER, type TenantRole } from "../lib/roles";
import { clearToken, getToken, setToken, tenantScope } from "../lib/session";
import { AlertsBell } from "./AlertsBell";
import { ConsoleShell, type NavSection } from "./ConsoleShell";
import { FullPageSpinner } from "./ui";

/** Menú de los roles que gestionan denuncias: misma estructura, ítems según el rol. */
function caseNav(role: CaseRole, base: string, plan: TenantPlan): NavSection[] {
  const inbox = { to: `${base}/cases`, label: CASE_VIEW[role].menu, icon: "inbox" as const };
  const deadlines = { to: `${base}/deadlines`, label: "Plazos", icon: "calendar" as const };
  const messages = { to: `${base}/messages`, label: "Mensajes", icon: "mail" as const };
  const reports = { to: `${base}/reports`, label: "Reportes", icon: "chart" as const, hidden: !planHas(plan, "reports") };
  const resources = {
    title: "Recursos",
    items: [
      { to: `${base}/flows`, label: "Flujo de denuncias", icon: "flow" as const },
      { to: `${base}/resources`, label: "Documentos del canal", icon: "book" as const },
    ],
  };

  switch (role) {
    case "case_manager":
      return [
        {
          title: "Denuncias",
          items: [
            inbox,
            { to: `${base}/unassigned`, label: "Por asignar", icon: "userPlus" },
            deadlines,
            messages,
          ],
        },
        { title: "Análisis", items: [reports] },
        resources,
      ];
    case "investigator":
      return [{ title: "Denuncias", items: [inbox, deadlines, messages] }, resources];
    case "resolver":
      return [
        { title: "Denuncias", items: [inbox, { to: `${base}/resolved`, label: "Resueltas", icon: "archive" }] },
        { title: "Análisis", items: [reports] },
        resources,
      ];
    case "auditor":
      return [
        { title: "Denuncias", items: [inbox, deadlines] },
        {
          title: "Control",
          items: [reports, { to: `${base}/access-log`, label: "Registro de accesos", icon: "activity" }],
        },
        resources,
      ];
  }
}

/** Menú según el rol activo. Solo el administrador del canal ve la configuración. */
function navFor(user: ChannelUser, base: string, plan: TenantPlan): NavSection[] {
  const home: NavSection = { title: "General", items: [{ to: base, label: "Inicio", icon: "grid", end: true }] };
  const sections: NavSection[] =
    user.activeRole !== "client_admin" ? [home, ...caseNav(user.activeRole as CaseRole, base, plan)] : adminNav(base, plan, home);
  // Lo que el plan no incluye no aparece; una sección que queda vacía tampoco.
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !(i as { hidden?: boolean }).hidden) }))
    .filter((s) => s.items.length > 0);
}

function adminNav(base: string, plan: TenantPlan, home: NavSection): NavSection[] {
  return [
    home,
    {
      title: "Configuración del canal",
      items: [
        { to: `${base}/users`, label: "Usuarios y roles", icon: "users" },
        { to: `${base}/areas`, label: "Áreas", icon: "building" },
        { to: `${base}/categories`, label: "Categorías", icon: "grid" },
        { to: `${base}/portal`, label: "Portal del denunciante", icon: "external" },
        { to: `${base}/branding`, label: "Marca", icon: "palette", hidden: !planHas(plan, "branding") },
        { to: `${base}/mail`, label: "Correo saliente", icon: "mail", hidden: !planHas(plan, "custom_smtp") },
        { to: `${base}/settings`, label: "Reglas de gestión", icon: "settings" },
        { to: `${base}/flow-settings`, label: "Flujos de gestión", icon: "flow", hidden: !planHas(plan, "custom_flows") },
      ],
    },
    { title: "Control", items: [{ to: `${base}/audit`, label: "Auditoría", icon: "activity" }] },
    { title: "Recursos", items: [{ to: `${base}/flows`, label: "Flujo de denuncias", icon: "flow" }] },
  ];
}

/** Panel de una empresa. Lo usan todos sus roles; el menú cambia según el rol. */
export function ChannelLayout() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const scope = tenantScope(slug);
  const [token, setTokenState] = useState(() => getToken(scope));
  const [data, setData] = useState<{ user: ChannelUser; tenant: ChannelTenant; plan: TenantPlan } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const logout = useCallback(() => {
    clearToken(tenantScope(slug));
    navigate(`/${slug}/login`, { replace: true });
  }, [slug, navigate]);

  const updateToken = useCallback(
    (next: string) => {
      setToken(tenantScope(slug), next);
      setTokenState(next);
    },
    [slug],
  );

  useEffect(() => {
    if (!token) return logout();
    api<{ user: ChannelUser; tenant: ChannelTenant; plan: TenantPlan }>(`/t/${slug}/auth/me`, { token })
      .then(setData)
      .catch(logout);
  }, [slug, token, logout, reloadKey]);

  if (!data || !token) return <FullPageSpinner />;

  const base = `/${slug}`;

  /** Cambia de rol sin cerrar sesión y lleva al inicio de ese rol. */
  const switchRole = async (role: TenantRole) => {
    const res = await api<{ token: string }>(`/t/${slug}/auth/switch-role`, { method: "POST", token, body: { role } });
    updateToken(res.token);
    navigate(base);
  };

  const context: ChannelContext = {
    user: data.user,
    tenant: data.tenant,
    plan: data.plan,
    token,
    logout,
    updateToken,
    apiBase: `/t/${slug}`,
    basePath: base,
    refreshUser: () => setReloadKey((k) => k + 1),
    switchRole,
  };

  return (
    <ConsoleShell
      nav={navFor(data.user, base, data.plan)}
      caption={data.tenant.name}
      orgLogoUrl={data.tenant.branding?.logoUrl}
      style={brandStyle(data.tenant.branding?.primaryColor)}
      poweredBy
      headerActions={
        // Alertas de plazos para quienes tienen denuncias a su cargo.
        data.user.activeRole === "case_manager" || data.user.activeRole === "investigator" ? (
          <AlertsBell apiBase={`/t/${slug}`} token={token} basePath={base} />
        ) : undefined
      }
      user={data.user}
      roleLabel={ROLES[data.user.activeRole].label}
      accountPath={`${base}/account`}
      onLogout={logout}
      roleSwitch={{
        options: ROLE_ORDER.filter((r) => data.user.roles.includes(r)).map((r) => ({ value: r, label: ROLES[r].label })),
        active: data.user.activeRole,
        onSwitch: (value) => switchRole(value as TenantRole),
      }}
    >
      <Outlet context={context} />
    </ConsoleShell>
  );
}

/**
 * Protege las rutas de configuración: solo el administrador del canal puede verlas.
 * El resto de los roles vuelve al inicio (el backend igualmente rechaza sus peticiones).
 */
export function RequireChannelAdmin() {
  const context = useOutletContext<ChannelContext>();
  if (context.user.activeRole !== "client_admin") return <Navigate to={context.basePath} replace />;
  return <Outlet context={context} />;
}

/** Vistas de un módulo que el plan de la empresa no incluye: vuelven al inicio (el backend igualmente las rechaza). */
export function RequirePlanFeature({ feature }: { feature: PlanFeature }) {
  const context = useOutletContext<ChannelContext>();
  if (!planHas(context.plan, feature)) return <Navigate to={context.basePath} replace />;
  return <Outlet context={context} />;
}

/**
 * Protege las vistas de denuncias: el administrador del canal no accede a ellas.
 * `only` limita la vista a ciertos roles (si cambias de rol estando en ella, vuelves al inicio).
 */
export function RequireCaseRole({ only }: { only?: CaseRole[] }) {
  const context = useOutletContext<ChannelContext>();
  const role = context.user.activeRole;
  if (role === "client_admin" || (only && !only.includes(role))) return <Navigate to={context.basePath} replace />;
  return <Outlet context={context} />;
}
