import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Breadcrumbs, EmptyState, Icon, PageHeader, Panel } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { daysUntil } from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { FRAMEWORKS, type LegalFramework } from "../../lib/roles";
import { formatDate } from "../../lib/ui-helpers";
import { DemoTag } from "./CasesPage";

interface Deadline {
  key: string;
  label: string;
  dueAt: string;
  detail: string;
  case: { id: string; code: string; subject: string; category: string; framework: LegalFramework; isDemo: boolean };
}

const GROUPS = [
  { key: "late", title: "Vencidos", test: (d: number) => d < 0, tone: "text-red-700", dot: "bg-red-500" },
  { key: "week", title: "Próximos 7 días", test: (d: number) => d >= 0 && d <= 7, tone: "text-amber-700", dot: "bg-amber-500" },
  { key: "later", title: "Más adelante", test: (d: number) => d > 7, tone: "text-gray-600", dot: "bg-emerald-500" },
];

/** Agenda de plazos pendientes de las denuncias abiertas que el rol puede ver. */
export function DeadlinesPage() {
  const { user, token, apiBase, basePath, logout } = useChannel();
  const [items, setItems] = useState<Deadline[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ deadlines: Deadline[] }>(`${apiBase}/cases/deadlines`, { token })
      .then((res) => setItems(res.deadlines))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, user.activeRole]);

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Plazos" }]} />
      <PageHeader
        title="Plazos"
        description="Vencimientos pendientes de las denuncias abiertas a tu cargo, según la Ley Karin (días hábiles) o las buenas prácticas ISO 37002."
      />
      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      {items === null ? (
        <p className="py-16 text-center text-sm text-gray-500">Cargando plazos…</p>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState title="Sin plazos pendientes" description="No hay denuncias abiertas con vencimientos a tu cargo." />
        </Panel>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-3">
          {GROUPS.map((g) => {
            const list = items.filter((d) => g.test(daysUntil(d.dueAt)));
            return (
              <Panel
                key={g.key}
                flush
                title={
                  <span className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${g.dot}`} />
                    {g.title}
                  </span>
                }
                counter={list.length}
              >
                {list.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm text-gray-500">Nada por aquí.</p>
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {list.map((d) => {
                      const days = daysUntil(d.dueAt);
                      return (
                        <li key={d.case.id + d.key}>
                          <Link
                            to={`${basePath}/cases/${d.case.id}`}
                            className="block px-4 py-3.5 transition hover:bg-gray-50/70 sm:px-6"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-medium text-gray-900">{d.label}</p>
                              <span className={`shrink-0 text-xs font-semibold ${g.tone}`}>
                                {days < 0 ? `hace ${-days} d` : days === 0 ? "hoy" : `en ${days} d`}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-sm text-gray-600">{d.case.subject}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                              <span className="font-mono">{d.case.code}</span>
                              <span aria-hidden>·</span>
                              {FRAMEWORKS[d.case.framework].label}
                              <span aria-hidden>·</span>
                              <span className="inline-flex items-center gap-1">
                                <Icon name="calendar" className="size-3" />
                                {formatDate(d.dueAt)}
                              </span>
                              {d.case.isDemo && <DemoTag />}
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
