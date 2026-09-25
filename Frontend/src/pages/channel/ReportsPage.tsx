import { useEffect, useState } from "react";
import { Alert, Breadcrumbs, EmptyState, PageHeader, Panel, StatCard } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { type CaseSummary, STATUS, STATUS_ORDER, dueState, elapsedDays } from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { FRAMEWORKS, FRAMEWORK_ORDER } from "../../lib/roles";

/** Barra horizontal simple para las distribuciones. */
function Bars({ rows }: { rows: { label: string; value: number; dot: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-gray-700">
              <span className={`size-2 shrink-0 rounded-full ${r.dot}`} />
              <span className="truncate">{r.label}</span>
            </span>
            <span className="font-semibold text-gray-900 tabular-nums">{r.value}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className={`h-full rounded-full ${r.dot}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Estadísticas de las denuncias que el rol puede ver (nunca muestran contenido). */
export function ReportsPage() {
  const { user, token, apiBase, basePath, logout } = useChannel();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ cases: CaseSummary[] }>(`${apiBase}/cases`, { token })
      .then((res) => setCases(res.cases))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, user.activeRole]);

  const list = cases ?? [];
  const open = list.filter((c) => c.status !== "closed");
  const closed = list.filter((c) => c.status === "closed");
  const late = open.filter((c) => dueState(c).tone === "late");
  const avgClose = closed.length
    ? Math.round(closed.reduce((sum, c) => sum + elapsedDays(c.receivedAt, c.closedAt!), 0) / closed.length)
    : null;
  const onTime = open.length ? Math.round(((open.length - late.length) / open.length) * 100) : 100;

  const byCategory = Object.entries(
    list.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.category.name]: (acc[c.category.name] ?? 0) + 1 }), {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, dot: "bg-highlight" }));
  const byFramework = FRAMEWORK_ORDER.map((fw) => ({
    label: FRAMEWORKS[fw].label,
    value: list.filter((c) => c.category.framework === fw).length,
    dot: FRAMEWORKS[fw].dot,
  }));
  const byStatus = STATUS_ORDER.map((s) => ({ label: STATUS[s].label, value: list.filter((c) => c.status === s).length, dot: STATUS[s].dot }));

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Reportes" }]} />
      <PageHeader
        title="Reportes"
        description="Indicadores de las denuncias a tu alcance: volumen, estados, categorías y cumplimiento de plazos. Solo cifras, sin contenido."
      />
      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      {cases !== null && list.length === 0 ? (
        <Panel>
          <EmptyState title="Sin datos" description="Cuando haya denuncias a tu alcance verás aquí sus indicadores." />
        </Panel>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Denuncias" value={cases ? list.length : "–"} icon="shield" />
            <StatCard label="Abiertas" value={cases ? open.length : "–"} icon="inbox" />
            <StatCard
              label="Cumplimiento de plazos"
              value={cases ? `${onTime}%` : "–"}
              icon="clock"
              tone={onTime < 100 ? "warning" : "success"}
            />
            <StatCard label="Días promedio de cierre" value={cases ? (avgClose ?? "–") : "–"} icon="calendar" />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            <Panel title="Por estado">
              <Bars rows={byStatus} />
            </Panel>
            <Panel title="Por marco legal">
              <Bars rows={byFramework} />
            </Panel>
            <Panel title="Por categoría">
              <Bars rows={byCategory} />
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
