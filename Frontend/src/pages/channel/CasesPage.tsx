import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  Badge,
  Breadcrumbs,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  SearchInput,
  td,
  th,
} from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import {
  CASE_VIEW,
  type CaseRole,
  type CaseStatus,
  type CaseSummary,
  DUE_STYLES,
  STATUS,
  STATUS_ORDER,
  dueState,
} from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { planHas } from "../../lib/plans";
import { FRAMEWORKS } from "../../lib/roles";
import { buttonClass, formatDate } from "../../lib/ui-helpers";
import { AssignFlow, QuickActionDialog } from "./AssignFlow";

/** Vistas de la bandeja: todas, sin investigador asignado o ya resueltas. */
export type CaseScope = "default" | "unassigned" | "resolved";

const SCOPES: Record<
  Exclude<CaseScope, "default">,
  { menu: string; title: string; description: string }
> = {
  unassigned: {
    menu: "Por asignar",
    title: "Denuncias por asignar",
    description:
      "Denuncias en revisión que aún no tienen investigador. Usa «Asignar» en cada una: te guía por los pasos que falten.",
  },
  resolved: {
    menu: "Resueltas",
    title: "Denuncias resueltas",
    description:
      "Denuncias con resolución aprobada: cerradas, y de Ley Karin en seguimiento (informe a la DT y aplicación de medidas).",
  },
};

/** Bandeja de denuncias. La misma vista para todos los roles; el contenido depende del rol activo. */
export function CasesPage({ scope = "default" }: { scope?: CaseScope }) {
  const { user, plan, token, apiBase, basePath, logout } = useChannel();
  const role = user.activeRole as CaseRole;
  const view = scope === "default" ? CASE_VIEW[role] : SCOPES[scope];
  const inScope = (c: CaseSummary) =>
    scope === "unassigned"
      ? // Ya iniciadas y sin investigador. Las que investiga la DT no necesitan investigador interno.
        !c.investigator &&
        c.route !== "dt" &&
        ["in_review", "investigating"].includes(c.status)
      : scope === "resolved"
        ? c.status === "closed" || c.status === "follow_up"
        : role === "resolver"
          ? c.status === "resolution"
          : true;
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CaseStatus | "">("");
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // El gestor trabaja desde la lista: cada fila muestra la acción que le toca según su estado.
  const canAssign = scope === "unassigned" && role === "case_manager";
  const rowAction =
    role === "case_manager" && (scope === "default" || scope === "unassigned");
  const actionFor = (c: CaseSummary) =>
    c.status === "received"
      ? {
          label: "Iniciar revisión",
          icon: "check" as const,
          run: () => setReviewing(c.id),
        }
      : !c.investigator &&
          c.route !== "dt" &&
          (c.status === "in_review" || c.status === "investigating")
        ? {
            label: "Asignar",
            icon: "userPlus" as const,
            run: () => setAssigning(c.id),
          }
        : null;

  useEffect(() => {
    api<{ cases: CaseSummary[]; hiddenByConflict: number }>(
      `${apiBase}/cases`,
      { token },
    )
      .then((res) => {
        setCases(res.cases);
        setHidden(res.hiddenByConflict);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, role, reloadKey]);

  const scoped = cases?.filter(inScope) ?? null;
  const q = query.trim().toLowerCase();
  const visible =
    scoped?.filter(
      (c) =>
        (!status || c.status === status) &&
        (!q ||
          c.code.toLowerCase().includes(q) ||
          c.subject.toLowerCase().includes(q) ||
          c.category.name.toLowerCase().includes(q)),
    ) ?? [];
  const count = (s: CaseStatus) =>
    scoped?.filter((c) => c.status === s).length ?? 0;
  const statuses = STATUS_ORDER.filter((s) =>
    scoped?.some((c) => c.status === s),
  );
  const hasDemo = cases?.some((c) => c.isDemo);

  return (
    <>
      <Breadcrumbs
        items={[{ label: "Inicio", to: basePath }, { label: view.menu }]}
      />
      <PageHeader
        title={view.title}
        description={view.description}
        actions={
          user.activeRole === "case_manager" && scope === "default" && planHas(plan, "register_cases") ? (
            <Link
              to={`${basePath}/cases/new`}
              className={buttonClass("primary", "w-full sm:w-auto")}
            >
              <Icon name="plus" />
              Registrar denuncia
            </Link>
          ) : undefined
        }
      />

      <div className="mb-6 space-y-3">
        {error && <Alert>{error}</Alert>}
        {flash && <Alert type="success">{flash}</Alert>}
        {canAssign && (
          <Alert type="info">
            Aquí están las denuncias ya iniciadas. Para asignarlas: en Ley
            Karin, primero se define si investiga la empresa o la Dirección del
            Trabajo; luego se elige al investigador. El botón{" "}
            <strong>Asignar</strong> hace los pasos que falten, en orden. Las
            recién llegadas se inician desde la{" "}
            <strong>Bandeja de denuncias</strong>.
          </Alert>
        )}
        {rowAction && scope === "default" && count("received") > 0 && (
          <Alert type="info">
            {count("received") === 1
              ? "Hay 1 denuncia nueva"
              : `Hay ${count("received")} denuncias nuevas`}{" "}
            sin revisar. Usa <strong>Iniciar revisión</strong> en cada una (en
            Ley Karin, las medidas de resguardo son el mismo día).{" "}
            {status !== "received" && (
              <button
                onClick={() => setStatus("received")}
                className="font-semibold text-highlight-text underline"
              >
                Ver solo las nuevas
              </button>
            )}
          </Alert>
        )}
        {hasDemo && (
          <Alert type="info">
            Hay <strong>denuncias de ejemplo</strong> en la bandeja. Puedes
            practicar el flujo completo con ellas; el administrador del canal
            las quita desde su inicio.
          </Alert>
        )}
        {hidden > 0 && (
          <Alert type="info">
            {hidden === 1 ? "Hay 1 denuncia" : `Hay ${hidden} denuncias`} que no
            se muestran porque estás involucrado
            {hidden === 1 ? "" : " en ellas"}. Se gestionan según el plan ante
            conflicto de interés.
          </Alert>
        )}
      </div>

      <Panel
        flush
        title="Denuncias"
        counter={scoped ? visible.length : undefined}
        toolbar={
          <div className="space-y-4">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Buscar por código, asunto o categoría"
            />
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {(["", ...statuses] as const).map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => setStatus(s)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                    status === s
                      ? "bg-accent text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                  }`}
                >
                  {s ? STATUS[s].label : "Todas"}
                  <span className="ml-1.5 opacity-70">
                    {s ? count(s) : (scoped?.length ?? 0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        }
      >
        {scoped === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">
            Cargando denuncias…
          </p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={scoped.length ? "Sin resultados" : "No hay denuncias"}
            description={
              scoped.length
                ? "Ninguna denuncia coincide con los filtros."
                : "Cuando haya denuncias en esta vista aparecerán aquí."
            }
          />
        ) : (
          <>
            <div className="relative hidden overflow-x-auto md:block">
              <table className="min-w-full">
                <thead className="border-b border-line-soft bg-gray-50/70">
                  <tr>
                    <th className={th}>Denuncia</th>
                    <th className={th}>Categoría</th>
                    <th className={th}>Estado</th>
                    <th className={th}>Plazo</th>
                    <th className={`${th} hidden 2xl:table-cell`}>
                      Investigador
                    </th>
                    <th className={`${th} hidden 2xl:table-cell`}>Recibida</th>
                    {rowAction && (
                      <th className={th}>
                        {canAssign ? "Siguiente paso" : "Acción"}
                      </th>
                    )}
                    <th className={th}>
                      <span className="sr-only">Ver</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {visible.map((c) => {
                    const due = dueState(c);
                    const act = rowAction ? actionFor(c) : null;
                    return (
                      <tr
                        key={c.id}
                        className="group transition hover:bg-gray-50/70"
                      >
                        <td className={`${td} min-w-64 whitespace-normal`}>
                          <Link
                            to={`${basePath}/cases/${c.id}`}
                            className="block"
                          >
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs text-gray-500">
                                {c.code}
                              </span>
                              {c.isDemo && <DemoTag />}
                              {c.urgentProtection && <UrgentTag />}
                              <UnreadTag count={c.unreadMessages} />
                            </span>
                            <span className="mt-0.5 block font-medium text-gray-900 group-hover:text-accent">
                              {c.subject}
                            </span>
                          </Link>
                        </td>
                        <td className={`${td} min-w-44 whitespace-normal`}>
                          <span className="block text-gray-900">
                            {c.category.name}
                          </span>
                          <span className="text-xs text-gray-500">
                            {FRAMEWORKS[c.category.framework].label}
                          </span>
                        </td>
                        <td className={td}>
                          <Badge {...STATUS[c.status]} />
                        </td>
                        <td
                          className={`${td} font-medium ${DUE_STYLES[due.tone]}`}
                        >
                          {due.label}
                        </td>
                        <td
                          className={`${td} hidden text-gray-600 2xl:table-cell`}
                        >
                          {c.investigator?.name ?? "Sin asignar"}
                        </td>
                        <td
                          className={`${td} hidden text-gray-500 2xl:table-cell`}
                        >
                          {formatDate(c.receivedAt)}
                        </td>
                        {rowAction && (
                          <td className={td}>
                            {act && (
                              <span className="flex items-center gap-3">
                                {canAssign && (
                                  <span className="hidden text-gray-600 xl:inline">
                                    {nextStep(c)}
                                  </span>
                                )}
                                <button
                                  onClick={act.run}
                                  className={buttonClass("primary", "h-9 px-3")}
                                >
                                  <Icon name={act.icon} />
                                  {act.label}
                                </button>
                              </span>
                            )}
                          </td>
                        )}
                        <td className={`${td} w-px text-right`}>
                          <Link
                            to={`${basePath}/cases/${c.id}`}
                            aria-label={`Abrir ${c.code}`}
                            className="inline-flex rounded-md p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                          >
                            <Icon name="chevron" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line-soft md:hidden">
              {visible.map((c) => {
                const due = dueState(c);
                const act = rowAction ? actionFor(c) : null;
                return (
                  <li key={c.id}>
                    <Link
                      to={`${basePath}/cases/${c.id}`}
                      className="flex items-start gap-3 px-4 pt-4 pb-4 active:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2">
                          <span className="font-mono text-xs text-gray-500">
                            {c.code}
                          </span>
                          {c.isDemo && <DemoTag />}
                          {c.urgentProtection && <UrgentTag />}
                          <UnreadTag count={c.unreadMessages} />
                        </p>
                        <p className="mt-1 font-medium text-gray-900">
                          {c.subject}
                        </p>
                        <p className="mt-0.5 text-sm text-gray-500">
                          {c.category.name}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <Badge {...STATUS[c.status]} />
                          <span
                            className={`text-xs font-medium ${DUE_STYLES[due.tone]}`}
                          >
                            {due.label}
                          </span>
                        </div>
                      </div>
                      <Icon
                        name="chevron"
                        className="mt-1 size-4 shrink-0 text-gray-300"
                      />
                    </Link>
                    {rowAction && act && (
                      <div className="flex items-center justify-between gap-3 px-4 pb-4">
                        <span className="text-xs text-gray-500">
                          {canAssign
                            ? `Siguiente: ${nextStep(c).toLowerCase()}`
                            : ""}
                        </span>
                        <button
                          onClick={act.run}
                          className={buttonClass(
                            "primary",
                            "h-9 shrink-0 px-3",
                          )}
                        >
                          <Icon name={act.icon} />
                          {act.label}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      {reviewing && (
        <QuickActionDialog
          caseId={reviewing}
          action="start_review"
          onClose={() => setReviewing(null)}
          onDone={(summary) => {
            setReviewing(null);
            setFlash(`${summary} Ya puedes asignarla con «Asignar».`);
            setReloadKey((k) => k + 1);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
      {assigning && (
        <AssignFlow
          caseId={assigning}
          onClose={() => {
            setAssigning(null);
            setReloadKey((k) => k + 1);
          }}
          onFinished={(summary) => {
            setAssigning(null);
            setFlash(summary);
            setReloadKey((k) => k + 1);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </>
  );
}

/** Qué le falta a una denuncia para quedar con investigador. */
function nextStep(c: CaseSummary): string {
  if (c.category.framework === "ley_karin" && !c.route)
    return "Definir procedimiento";
  return "Elegir investigador";
}

/** Mensajes nuevos del denunciante. */
function UnreadTag({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-highlight px-2 py-0.5 text-[11px] font-semibold text-white">
      <Icon name="mail" className="size-3" />
      {count}
    </span>
  );
}

/** La persona pidió medidas de protección urgentes (Ley Karin). */
export function UrgentTag() {
  return (
    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-red-700 uppercase ring-1 ring-red-600/20 ring-inset">
      Protección urgente
    </span>
  );
}

export function DemoTag() {
  return (
    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase ring-1 ring-amber-600/20 ring-inset">
      Ejemplo
    </span>
  );
}
