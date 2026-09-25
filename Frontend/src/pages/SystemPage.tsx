import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Breadcrumbs, Button, Icon, PageHeader, Panel, StatCard, td, th } from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import type { SystemStatus } from "../lib/types";
import { formatDate } from "../lib/ui-helpers";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const OK = { styles: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", dot: "bg-emerald-500" };
const WARN = { styles: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" };
const DOWN = { styles: "bg-red-50 text-red-700 ring-red-600/15", dot: "bg-red-500" };

export function SystemPage() {
  const { token, logout } = useAdmin();
  const [data, setData] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<SystemStatus>("/admin/system", { token })
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      })
      .finally(() => setLoading(false));
  }, [token, logout, reloadKey]);

  const down = data?.tenants.filter((t) => !t.reachable).length ?? 0;
  const outdated = data?.tenants.filter((t) => t.reachable && t.pendingMigrations.length > 0).length ?? 0;
  const totalSize = data
    ? data.database.globalSizeBytes + data.tenants.reduce((sum, t) => sum + (t.reachable ? t.sizeBytes : 0), 0)
    : 0;

  return (
    <>
      <Breadcrumbs items={[{ label: "Consola", to: "/admin" }, { label: "Estado del sistema" }]} />
      <PageHeader
        title="Estado del sistema"
        description="Salud de la base de datos central y de la base dedicada de cada empresa, con su versión de esquema."
        actions={
          <Button
            onClick={() => {
              setLoading(true);
              setReloadKey((k) => k + 1);
            }}
            loading={loading}
            className="w-full sm:w-auto"
          >
            <Icon name="refresh" />
            Verificar ahora
          </Button>
        }
      />

      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      {data && (
        <>
          <div className="mb-6">
            {down > 0 ? (
              <Alert>
                {down} {down === 1 ? "base de datos de empresa no responde" : "bases de datos de empresas no responden"}.
              </Alert>
            ) : outdated > 0 ? (
              <Alert type="info">
                {outdated} {outdated === 1 ? "empresa tiene" : "empresas tienen"} migraciones pendientes. Se aplican
                automáticamente al reiniciar el backend.
              </Alert>
            ) : (
              <Alert type="success">Todos los servicios operan con normalidad.</Alert>
            )}
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="PostgreSQL" value={data.database.version.split(" ")[0]} icon="server" />
            <StatCard label="Latencia base central" value={`${data.database.latencyMs} ms`} icon="clock" tone="success" />
            <StatCard label="Bases de empresas" value={data.tenants.length} icon="database" />
            <StatCard label="Almacenamiento total" value={formatBytes(totalSize)} icon="database" />
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className="space-y-6">
              <Panel title="Base de datos central">
                <dl className="space-y-5 text-sm">
                  <div>
                    <dt className="text-gray-500">Servidor</dt>
                    <dd className="mt-1 font-mono text-[13px] break-all text-gray-900">{data.database.host ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Tamaño</dt>
                    <dd className="mt-1 font-medium text-gray-900">{formatBytes(data.database.globalSizeBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Versión de esquema</dt>
                    <dd className="mt-1 font-mono text-[13px] text-gray-900">{data.database.globalMigration ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Esquema vigente de empresas</dt>
                    <dd className="mt-1 font-mono text-[13px] text-gray-900">
                      {data.tenantSchema.latest ?? "—"}{" "}
                      <span className="font-sans text-gray-500">({data.tenantSchema.total} migraciones)</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Última verificación</dt>
                    <dd className="mt-1 text-gray-900">{formatDate(data.checkedAt, true)}</dd>
                  </div>
                </dl>
              </Panel>

              <Panel
                title="Registros de auditoría"
                description={`En la base se guardan los últimos ${data.audit.hotMonths} meses; los anteriores se archivan comprimidos en el almacenamiento de archivos.`}
              >
                <dl className="grid grid-cols-2 gap-5 text-sm">
                  <div>
                    <dt className="text-gray-500">Eventos en la base</dt>
                    <dd className="mt-1 font-medium text-gray-900">{data.audit.database.events.toLocaleString("es-CL")}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Espacio en la base</dt>
                    <dd className="mt-1 font-medium text-gray-900">{formatBytes(data.audit.database.bytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Desde</dt>
                    <dd className="mt-1 text-gray-900">
                      {data.audit.database.oldest ? formatDate(data.audit.database.oldest) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Meses archivados</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {data.audit.archives.length}
                      {data.audit.archives.length > 0 && (
                        <span className="font-normal text-gray-500">
                          {" "}
                          ({formatBytes(data.audit.archives.reduce((n, a) => n + a.bytes, 0))} comprimidos)
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
                {data.audit.archives.length > 0 && (
                  <ul className="mt-5 divide-y divide-line-soft border-t border-line-soft text-sm">
                    {data.audit.archives.slice(0, 12).map((a) => (
                      <li key={a.key} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="font-medium text-gray-900">{a.month}</span>
                        <span className="text-gray-500">
                          {a.events.toLocaleString("es-CL")} eventos · {formatBytes(a.bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel flush title="Bases de datos por empresa" counter={data.tenants.length}>
              <div className="relative hidden overflow-x-auto md:block">
                <table className="min-w-full">
                  <thead className="border-b border-line-soft bg-gray-50/70">
                    <tr>
                      <th className={th}>Empresa</th>
                      <th className={th}>Conexión</th>
                      <th className={th}>Esquema</th>
                      <th className={th}>Tamaño</th>
                      <th className={th}>Latencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {data.tenants.map((t) => (
                      <tr key={t.slug}>
                        <td className={td}>
                          <Link to={`/admin/tenants/${t.slug}`} className="font-medium text-gray-900 hover:text-accent">
                            {t.name}
                          </Link>
                          <p className="font-mono text-xs text-gray-500">{t.dbName}</p>
                        </td>
                        <td className={td}>
                          {t.reachable ? <Badge {...OK} label="Disponible" /> : <Badge {...DOWN} label="Sin respuesta" />}
                        </td>
                        <td className={td}>
                          {!t.reachable ? (
                            "—"
                          ) : t.pendingMigrations.length ? (
                            <Badge {...WARN} label={`${t.pendingMigrations.length} pendiente(s)`} />
                          ) : (
                            <Badge {...OK} label="Al día" />
                          )}
                        </td>
                        <td className={`${td} text-gray-600`}>{t.reachable ? formatBytes(t.sizeBytes) : "—"}</td>
                        <td className={`${td} text-gray-600`}>{t.reachable ? `${t.latencyMs} ms` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-line-soft md:hidden">
                {data.tenants.map((t) => (
                  <li key={t.slug} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/admin/tenants/${t.slug}`} className="truncate font-medium text-gray-900">
                        {t.name}
                      </Link>
                      {t.reachable ? <Badge {...OK} label="Disponible" /> : <Badge {...DOWN} label="Sin respuesta" />}
                    </div>
                    <p className="mt-1 font-mono text-xs text-gray-500">{t.dbName}</p>
                    {t.reachable && (
                      <p className="mt-1.5 text-xs text-gray-500">
                        {t.pendingMigrations.length
                          ? `${t.pendingMigrations.length} migración(es) pendiente(s)`
                          : "Esquema al día"}{" "}
                        · {formatBytes(t.sizeBytes)} · {t.latencyMs} ms
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {data.tenants.length === 0 && (
                <p className="px-6 py-10 text-center text-sm text-gray-500">No hay empresas registradas.</p>
              )}
            </Panel>
          </div>
        </>
      )}

      {!data && !error && <p className="py-16 text-center text-sm text-gray-500">Verificando servicios…</p>}
    </>
  );
}
