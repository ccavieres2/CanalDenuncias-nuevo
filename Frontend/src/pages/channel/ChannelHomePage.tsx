import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Icon, PageHeader, Panel, StatCard } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import { CASE_VIEW, type CaseRole, type CaseSummary, DUE_STYLES, ROLE_CAPABILITIES, STATUS, dueState } from "../../lib/cases";
import type { ChannelOverview } from "../../lib/channel-types";
import { ROLES, ROLE_ORDER } from "../../lib/roles";
import { buttonClass } from "../../lib/ui-helpers";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

/** Inicio del panel: el administrador ve la puesta en marcha del canal; el resto, su rol. */
export function ChannelHomePage() {
  const { user } = useChannel();
  return user.activeRole === "client_admin" ? <AdminHome /> : <MemberHome />;
}

function AdminHome() {
  const { user, tenant, token, apiBase, basePath, logout } = useChannel();
  const [data, setData] = useState<(ChannelOverview & { demoCases: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    api<ChannelOverview & { demoCases: number }>(`${apiBase}/console/overview`, { token })
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, reloadKey]);

  async function toggleDemo() {
    if (!data) return;
    setDemoBusy(true);
    setError(null);
    try {
      await api(`${apiBase}/console/demo-cases`, { method: data.demoCases ? "DELETE" : "POST", token });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setDemoBusy(false);
    }
  }

  const done = data?.checklist.filter((c) => c.done).length ?? 0;
  const total = data?.checklist.length ?? 0;
  const ready = data && done === total;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name.split(" ")[0]}`}
        description={`Administración del canal de denuncias de ${tenant.name}.`}
        actions={
          <Link to={`${basePath}/users`} className={buttonClass("primary", "w-full sm:w-auto")}>
            <Icon name="plus" />
            Agregar usuario
          </Link>
        }
      />

      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Usuarios activos" value={data?.users.total ?? "–"} icon="users" />
        <StatCard
          label="Gestores de denuncias"
          value={data?.users.byRole.case_manager ?? "–"}
          icon="shield"
          tone={data && data.users.byRole.case_manager === 0 ? "warning" : "success"}
        />
        <StatCard label="Categorías activas" value={data?.categories.active ?? "–"} icon="grid" />
        <StatCard
          label="Cuentas sin 2FA"
          value={data?.users.mfaPending ?? "–"}
          icon="lock"
          tone={data && data.users.mfaPending > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel
          title="Puesta en marcha del canal"
          description={
            data
              ? ready
                ? "El canal está configurado para recibir y gestionar denuncias."
                : `${done} de ${total} pasos completados. Complétalos antes de habilitar la recepción de denuncias.`
              : undefined
          }
        >
          {!data ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : (
            <>
              <div className="mb-6 h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full transition-all ${ready ? "bg-emerald-500" : "bg-highlight"}`}
                  style={{ width: `${(done / total) * 100}%` }}
                />
              </div>
              <ol className="space-y-1">
                {data.checklist.map((item) => (
                  <li key={item.key}>
                    <Link
                      to={`${basePath}/${item.to}`}
                      className="-mx-3 flex items-start gap-4 rounded-lg px-3 py-3 transition hover:bg-gray-50"
                    >
                      <span
                        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                          item.done ? "bg-emerald-500 text-white" : "ring-2 ring-gray-300 ring-inset"
                        }`}
                      >
                        {item.done && <Icon name="check" className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-medium ${item.done ? "text-gray-500" : "text-gray-900"}`}>
                          {item.title}
                        </span>
                        <span className="mt-0.5 block text-sm text-gray-500">{item.detail}</span>
                      </span>
                      {!item.done && <Icon name="chevron" className="mt-1 size-4 shrink-0 text-gray-400" />}
                    </Link>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel
            flush
            title="Equipo del canal"
            actions={
              <Link to={`${basePath}/users`} className={buttonClass("link", "h-9 px-3")}>
                Gestionar
                <Icon name="chevron" className="size-3.5" />
              </Link>
            }
          >
            <ul className="divide-y divide-line-soft">
              {ROLE_ORDER.map((role) => (
                <li key={role} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{ROLES[role].label}</span>
                    <span className="block text-xs text-gray-500">{ROLES[role].seesCases}</span>
                  </span>
                  <span className="text-lg font-semibold text-gray-900 tabular-nums">
                    {data?.users.byRole[role] ?? "–"}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Denuncias de ejemplo">
            <p className="text-sm leading-relaxed text-gray-600">
              Carga 7 denuncias ficticias en distintas etapas para practicar el flujo con cada rol: gestor, investigador,
              resolutor y auditor. Tú no las verás como administrador; cambia de rol o ingresa con esos usuarios. Las
              denuncias reales llegan desde el portal del denunciante.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={toggleDemo} loading={demoBusy} variant={data?.demoCases ? "danger" : "normal"}>
                {data?.demoCases ? "Quitar ejemplos" : "Cargar ejemplos"}
              </Button>
              {!!data?.demoCases && <span className="text-sm text-gray-500">{data.demoCases} cargadas</span>}
            </div>
          </Panel>

          <Panel title="Tu rol en el canal">
            <p className="text-sm leading-relaxed text-gray-600">
              Como <strong className="text-gray-900">administrador del canal</strong> configuras usuarios, categorías y el
              portal, pero <strong className="text-gray-900">no accedes al contenido de las denuncias</strong> con este rol.
              {user.roles.length > 1
                ? " Para gestionar denuncias, cambia de rol desde tu menú de usuario."
                : " Así se garantiza que la investigación la realicen personas designadas."}
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function MemberHome() {
  const { user, tenant, basePath, apiBase, token, logout } = useChannel();
  const role = ROLES[user.activeRole];
  const view = CASE_VIEW[user.activeRole as CaseRole];
  const otherRoles = ROLE_ORDER.filter((r) => r !== user.activeRole && user.roles.includes(r));
  const [cases, setCases] = useState<CaseSummary[] | null>(null);

  useEffect(() => {
    api<{ cases: CaseSummary[] }>(`${apiBase}/cases`, { token })
      .then((res) => setCases(res.cases))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) logout();
        else setCases([]);
      });
  }, [apiBase, token, logout, user.activeRole]);

  const open = cases?.filter((c) => c.status !== "closed") ?? [];
  const late = open.filter((c) => dueState(c).tone === "late").length;
  const soon = open.filter((c) => dueState(c).tone === "warn").length;
  const allowed = ROLE_CAPABILITIES[user.activeRole as CaseRole];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name.split(" ")[0]}`}
        description={`Canal de denuncias de ${tenant.name}.`}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatCard label="Abiertas" value={cases ? open.length : "–"} icon="shield" />
            <StatCard label="Por vencer" value={cases ? soon : "–"} icon="clock" tone={soon ? "warning" : "success"} />
            <StatCard label="Vencidas" value={cases ? late : "–"} icon="error" tone={late ? "warning" : "success"} />
          </div>

          <Panel
            flush
            title={view.menu}
            actions={
              <Link to={`${basePath}/cases`} className={buttonClass("link", "h-9 px-3")}>
                Ver todas
                <Icon name="chevron" className="size-3.5" />
              </Link>
            }
          >
            {cases === null ? (
              <p className="px-6 py-10 text-center text-sm text-gray-500">Cargando…</p>
            ) : open.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                  <Icon name="shield" className="size-5" />
                </div>
                <p className="text-base font-semibold text-gray-900">No tienes denuncias pendientes</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  Cuando haya denuncias que te correspondan aparecerán aquí, junto con sus plazos.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line-soft">
                {open.slice(0, 6).map((c) => {
                  const due = dueState(c);
                  return (
                    <li key={c.id}>
                      <Link
                        to={`${basePath}/cases/${c.id}`}
                        className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-gray-50/70 sm:px-6"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{c.subject}</p>
                          <p className="text-xs text-gray-500">
                            <span className="font-mono">{c.code}</span> · {c.category.name}
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <Badge {...STATUS[c.status]} />
                          <p className={`mt-1 text-xs font-medium ${DUE_STYLES[due.tone]}`}>{due.label}</p>
                        </div>
                        <Icon name="chevron" className="size-4 shrink-0 text-gray-300" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Tu rol">
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-base font-semibold text-gray-900">{role.label}</p>
              {user.area && <p className="text-gray-500">{user.area}</p>}
            </div>
            <p className="leading-relaxed text-gray-600">{role.description}</p>
            <div>
              <p className="text-gray-500">Qué puedes hacer con este rol</p>
              <ul className="mt-2 space-y-1.5">
                {allowed.map((a) => (
                  <li key={a} className="flex items-start gap-2 text-gray-700">
                    <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
            {otherRoles.length > 0 && (
              <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                También puedes trabajar como {otherRoles.map((r) => ROLES[r].label).join(", ")}. Cambia de rol desde tu
                menú de usuario.
              </p>
            )}
            <div>
              <p className="text-gray-500">Categorías a tu cargo</p>
              {user.categories === null ? (
                <p className="mt-1 font-medium text-gray-900">Todas las categorías</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {user.categories.map((c) => (
                    <li key={c} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link to={`${basePath}/account`} className={buttonClass("normal", "w-full")}>
              Mi cuenta
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
