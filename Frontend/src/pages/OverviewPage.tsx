import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AuditRow } from "../components/AuditRow";
import { Alert, Icon, PageHeader, Panel, StatCard, StatusIndicator } from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import type { Overview } from "../lib/types";
import { buttonClass, formatDate, initials } from "../lib/ui-helpers";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

export function OverviewPage() {
  const { token, logout, user } = useAdmin();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>("/admin/overview", { token })
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [token, logout]);

  const firstName = user.name.split(" ")[0];
  const mfaPending = data ? data.clientAdmins.mfaPending + data.team.mfaPending : 0;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description="Resumen del estado de la plataforma y la actividad reciente."
        actions={
          <Link to="/admin/tenants/new" className={buttonClass("primary", "w-full sm:w-auto")}>
            <Icon name="plus" />
            Crear empresa
          </Link>
        }
      />

      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Empresas activas" value={data ? `${data.tenants.active} / ${data.tenants.total}` : "–"} icon="building" />
        <StatCard label="Admins de empresas" value={data?.clientAdmins.total ?? "–"} icon="users" />
        <StatCard
          label="Accesos últimas 24 h"
          value={data?.last24h.logins ?? "–"}
          icon="activity"
          tone="success"
        />
        <StatCard
          label="Intentos fallidos 24 h"
          value={data?.last24h.failedLogins ?? "–"}
          icon="error"
          tone={data && data.last24h.failedLogins > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          flush
          title="Actividad reciente"
          actions={
            <Link to="/admin/audit" className={buttonClass("link", "h-9 px-3")}>
              Ver auditoría
              <Icon name="chevron" className="size-3.5" />
            </Link>
          }
        >
          {!data ? (
            <p className="px-6 py-12 text-center text-sm text-gray-500">Cargando…</p>
          ) : data.recentActivity.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-gray-500">Todavía no hay actividad registrada.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {data.recentActivity.map((e) => (
                <AuditRow key={e.id} event={e} compact />
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Requiere atención">
            {!data ? (
              <p className="text-sm text-gray-500">Cargando…</p>
            ) : data.attention.length === 0 && mfaPending === 0 ? (
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Icon name="check" />
                </span>
                Todo en orden. No hay pendientes.
              </div>
            ) : (
              <ul className="space-y-3">
                {data.attention.map((a) => (
                  <li key={a.slug + a.reason}>
                    <Link
                      to={`/admin/tenants/${a.slug}`}
                      className="flex items-start gap-3 rounded-lg p-2 -m-2 transition hover:bg-gray-50"
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        <Icon name="error" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">{a.name}</span>
                        <span className="block text-sm text-gray-500">{a.reason}</span>
                      </span>
                    </Link>
                  </li>
                ))}
                {mfaPending > 0 && (
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
                      <Icon name="lock" />
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium text-gray-900">
                        {mfaPending} {mfaPending === 1 ? "cuenta" : "cuentas"} sin verificación en dos pasos
                      </span>
                      <span className="block text-gray-500">
                        La configurarán en su próximo ingreso ({data.clientAdmins.mfaPending} de empresas,{" "}
                        {data.team.mfaPending} del equipo).
                      </span>
                    </span>
                  </li>
                )}
              </ul>
            )}
          </Panel>

          <Panel
            flush
            title="Últimas empresas"
            actions={
              <Link to="/admin/tenants" className={buttonClass("link", "h-9 px-3")}>
                Ver todas
                <Icon name="chevron" className="size-3.5" />
              </Link>
            }
          >
            {!data ? (
              <p className="px-6 py-8 text-center text-sm text-gray-500">Cargando…</p>
            ) : data.recentTenants.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-gray-500">Aún no hay empresas.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {data.recentTenants.map((t) => (
                  <li key={t.slug}>
                    <Link
                      to={`/admin/tenants/${t.slug}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-gray-50/70 sm:px-6"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-semibold text-gray-600 ring-1 ring-gray-200 ring-inset">
                        {initials(t.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{t.name}</span>
                        <span className="block text-xs text-gray-500">{formatDate(t.createdAt)}</span>
                      </span>
                      <StatusIndicator status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Equipo BeeHives">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-2xl font-semibold tracking-tight text-gray-900">{data?.team.total ?? "–"}</p>
                <p className="text-sm text-gray-500">miembros activos con acceso a la consola</p>
              </div>
              <Link to="/admin/team" className={buttonClass("normal")}>
                Gestionar
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
