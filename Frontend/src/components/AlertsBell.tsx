import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../lib/api";
import { Icon } from "./ui";

interface Alert {
  caseId: string;
  code: string;
  label: string;
  dueAt: string;
  legal: boolean;
  isDemo: boolean;
  days: number;
}

interface AlertsResponse {
  overdue: Alert[];
  dueSoon: Alert[];
  dueSoonDays: number;
}

// Se actualiza al cambiar de página y cada 5 minutos, sin recargar.
const REFRESH_MS = 5 * 60 * 1000;

const when = (a: Alert) =>
  a.days < 0 ? `Venció hace ${-a.days} ${a.days === -1 ? "día" : "días"}` : a.days === 0 ? "Vence hoy" : `Vence en ${a.days} ${a.days === 1 ? "día" : "días"}`;

/**
 * Campana de alertas del panel: plazos vencidos o por vencer a cargo de la persona (gestor o investigador), según el
 * procedimiento legal y el flujo de la empresa. Cada alerta lleva a su denuncia.
 */
export function AlertsBell({ apiBase, token, basePath }: { apiBase: string; token: string; basePath: string }) {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    const load = () =>
      api<AlertsResponse>(`${apiBase}/cases/alerts`, { token })
        .then(setData)
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [apiBase, token, location.pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const overdue = data?.overdue.length ?? 0;
  const total = overdue + (data?.dueSoon.length ?? 0);

  const section = (title: string, items: Alert[], late: boolean) =>
    items.length > 0 && (
      <div className="py-2">
        <p className={`px-4 pt-1 pb-2 text-[11px] font-semibold tracking-[0.08em] uppercase ${late ? "text-red-600" : "text-amber-600"}`}>
          {title} · {items.length}
        </p>
        <ul>
          {items.map((a) => (
            <li key={`${a.caseId}:${a.label}`}>
              <Link
                to={`${basePath}/cases/${a.caseId}`}
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 px-4 py-2.5 transition hover:bg-gray-50"
              >
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${late ? "bg-red-500" : "bg-amber-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{a.label}</span>
                  <span className="block text-xs text-gray-500">
                    <span className="font-mono">{a.code}</span> · {when(a)}
                    {a.legal && " · plazo legal"}
                    {a.isDemo && " · ejemplo"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={total ? `Alertas de plazos: ${total}` : "Alertas de plazos"}
        className="relative rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
      >
        <Icon name="bell" className="size-5" />
        {total > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white ring-2 ring-white ${
              overdue ? "bg-red-600" : "bg-amber-500"
            }`}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-white shadow-pop">
          <div className="border-b border-line-soft px-4 py-3.5">
            <p className="text-sm font-semibold text-gray-900">Alertas de plazos</p>
            <p className="text-xs text-gray-500">Denuncias a tu cargo vencidas o que vencen en los próximos {data?.dueSoonDays ?? 5} días.</p>
          </div>
          <div className="scrollbar-nav max-h-[min(24rem,60vh)] divide-y divide-line-soft overflow-y-auto">
            {total === 0 ? (
              <p className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
                <Icon name="success" className="size-4 text-emerald-600" />
                No tienes plazos vencidos ni por vencer.
              </p>
            ) : (
              <>
                {section("Vencidos", data!.overdue, true)}
                {section("Por vencer", data!.dueSoon, false)}
              </>
            )}
          </div>
          <Link
            to={`${basePath}/deadlines`}
            onClick={() => setOpen(false)}
            className="block border-t border-line-soft px-4 py-3 text-center text-sm font-medium text-highlight-text transition hover:bg-gray-50"
          >
            Ver todos los plazos
          </Link>
        </div>
      )}
    </div>
  );
}
