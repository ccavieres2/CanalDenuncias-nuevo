import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate, useOutletContext, useParams } from "react-router";
import { api } from "../lib/api";
import { brandStyle } from "../lib/branding";
import { CASE_VIEW, type CaseRole } from "../lib/cases";
import type { ChannelContext, ChannelTenant, ChannelUser } from "../lib/channel-context";
import { ROLES, ROLE_ORDER, type TenantRole } from "../lib/roles";
import { clearToken, getToken, setToken, tenantScope } from "../lib/session";
import { ConsoleShell, type NavSection } from "./ConsoleShell";
import { FullPageSpinner } from "./ui";

/** Menú de los roles que gestionan denuncias: misma estructura, ítems según el rol. */
function caseNav(role: CaseRole, base: string): NavSection[] {
  const inbox = { to: `${base}/cases`, label: CASE_VIEW[role].menu, icon: "inbox" as const };
  const deadlines = { to: `${base}/deadlines`, label: "Plazos", icon: "calendar" as const };
  const messages = { to: `${base}/messages`, label: "Mensajes", icon: "mail" as const };
  const reports = { to: `${base}/reports`, label: "Reportes", icon: "chart" as const };
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
function navFor(user: ChannelUser, base: string): NavSection[] {
  const home: NavSection = { title: "General", items: [{ to: base, label: "Inicio", icon: "grid", end: true }] };
  if (user.activeRole !== "client_admin") return [home, ...caseNav(user.activeRole as CaseRole, base)];
  return [
    home,
    {
      title: "Configuración del canal",
      items: [
        { to: `${base}/users`, label: "Usuarios y roles", icon: "users" },
        { to: `${base}/areas`, label: "Áreas", icon: "building" },
        { to: `${base}/categories`, label: "Categorías", icon: "grid" },
        { to: `${base}/portal`, label: "Portal del denunciante", icon: "external" },
        { to: `${base}/branding`, label: "Marca", icon: "palette" },
        { to: `${base}/mail`, label: "Correo saliente", icon: "mail" },
        { to: `${base}/settings`, label: "Reglas de gestión", icon: "settings" },
        { to: `${base}/flow-settings`, label: "Flujos de gestión", icon: "flow" },
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
  const [data, setData] = useState<{ user: ChannelUser; tenant: ChannelTenant } | null>(null);
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
    api<{ user: ChannelUser; tenant: { name: string; slug: string } }>(`/t/${slug}/auth/me`, { token })
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
      nav={navFor(data.user, base)}
      caption={data.tenant.name}
      orgLogoUrl={data.tenant.branding?.logoUrl}
      style={brandStyle(data.tenant.branding?.primaryColor)}
      poweredBy
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
