import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Breadcrumbs, Button, Icon, PageHeader, Panel, StatCard, StatusIndicator, td, th } from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import { type TenantUsage, usageCsv } from "../lib/usage";
import { formatBytes } from "../lib/ui-helpers";

/** Consumo de todas las empresas: denuncias, archivos y base de datos (para precios y capacidad). */
export function UsagePage() {
  const { token, logout } = useAdmin();
  const [usage, setUsage] = useState<TenantUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ usage: TenantUsage[] }>("/admin/usage", { token })
      .then((res) => setUsage(res.usage.sort((a, b) => b.storageBytes - a.storageBytes)))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [token, logout]);

  const sum = (f: (u: TenantUsage) => number) => (usage ?? []).reduce((acc, u) => acc + f(u), 0);

  function exportCsv() {
    if (!usage) return;
    const url = URL.createObjectURL(new Blob([usageCsv(usage)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `consumo-empresas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Consola", to: "/admin" }, { label: "Consumo" }]} />
      <PageHeader
        title="Consumo"
        description="Denuncias, archivos y base de datos de cada empresa, para definir precios y capacidad. Las denuncias de ejemplo no se cuentan."
        actions={
          <Button onClick={exportCsv} disabled={!usage?.length} className="w-full sm:w-auto">
            <Icon name="download" />
            Exportar CSV
          </Button>
        }
      />
      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Denuncias (total)" value={usage ? sum((u) => u.cases.total).toLocaleString("es-CL") : "…"} icon="inbox" />
        <StatCard label="Evidencias" value={usage ? sum((u) => u.files.evidenceCount).toLocaleString("es-CL") : "…"} icon="archive" />
        <StatCard label="Archivos" value={usage ? formatBytes(sum((u) => u.files.totalBytes)) : "…"} icon="database" />
        <StatCard label="Almacenamiento total" value={usage ? formatBytes(sum((u) => u.storageBytes)) : "…"} icon="server" />
      </div>

      <Panel flush title="Por empresa" counter={usage?.length}>
        {usage === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">Midiendo…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-line-soft bg-gray-50/70">
                <tr>
                  <th className={th}>Empresa</th>
                  <th className={th}>Plan</th>
                  <th className={`${th} text-right`}>Denuncias</th>
                  <th className={`${th} text-right`}>Abiertas</th>
                  <th className={`${th} text-right`}>Últimos 30 días</th>
                  <th className={`${th} text-right`}>Evidencias</th>
                  <th className={`${th} text-right`}>Archivos</th>
                  <th className={`${th} text-right`}>Base de datos</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Usuarios</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {usage.map((u) => (
                  <tr key={u.slug} className="transition hover:bg-gray-50/70">
                    <td className={td}>
                      <Link to={`/admin/tenants/${u.slug}`} className="font-medium text-gray-900 hover:text-accent">
                        {u.name}
                      </Link>
                      <span className="mt-0.5 flex items-center gap-2 font-mono text-xs text-gray-500">
                        {u.slug}
                        {u.status !== "active" && <StatusIndicator status={u.status} />}
                      </span>
                      {u.error && <span className="block text-xs text-red-600">{u.error}</span>}
                    </td>
                    <td className={td}>{u.plan}</td>
                    <td className={`${td} text-right font-medium text-gray-900`}>{u.cases.total.toLocaleString("es-CL")}</td>
                    <td className={`${td} text-right`}>{u.cases.open.toLocaleString("es-CL")}</td>
                    <td className={`${td} text-right`}>{u.cases.last30Days.toLocaleString("es-CL")}</td>
                    <td className={`${td} text-right`}>{u.files.evidenceCount.toLocaleString("es-CL")}</td>
                    <td className={`${td} text-right`}>{formatBytes(u.files.totalBytes)}</td>
                    <td className={`${td} text-right`}>{formatBytes(u.databaseBytes)}</td>
                    <td className={`${td} text-right font-medium text-gray-900`}>{formatBytes(u.storageBytes)}</td>
                    <td className={`${td} text-right`}>{u.users.active.toLocaleString("es-CL")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
