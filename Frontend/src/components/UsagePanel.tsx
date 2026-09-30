import { FRAMEWORKS, FRAMEWORK_ORDER } from "../lib/roles";
import type { TenantUsage } from "../lib/usage";
import { formatBytes } from "../lib/ui-helpers";
import { Alert, KeyValue, Panel } from "./ui";

/** Consumo de una empresa en su ficha de la consola. */
export function UsagePanel({ usage }: { usage: TenantUsage | null }) {
  return (
    <Panel title="Consumo" description="Para precios y capacidad. Las denuncias de ejemplo no se cuentan.">
      {!usage ? (
        <p className="text-sm text-gray-500">Midiendo…</p>
      ) : usage.error ? (
        <Alert>{usage.error}</Alert>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <KeyValue label="Denuncias (total)">{usage.cases.total.toLocaleString("es-CL")}</KeyValue>
            <KeyValue label="Abiertas">{usage.cases.open.toLocaleString("es-CL")}</KeyValue>
            <KeyValue label="Cerradas">{usage.cases.closed.toLocaleString("es-CL")}</KeyValue>
            <KeyValue label="Este mes">{usage.cases.thisMonth.toLocaleString("es-CL")}</KeyValue>
            <KeyValue label="Últimos 30 días">{usage.cases.last30Days.toLocaleString("es-CL")}</KeyValue>
            <KeyValue label="Usuarios activos">{usage.users.active.toLocaleString("es-CL")}</KeyValue>
          </dl>
          <div className="flex flex-wrap gap-1.5">
            {FRAMEWORK_ORDER.map((fw) => (
              <span key={fw} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${FRAMEWORKS[fw].styles}`}>
                <span className={`size-1.5 rounded-full ${FRAMEWORKS[fw].dot}`} />
                {FRAMEWORKS[fw].label}: {usage.cases.byFramework[fw] ?? 0}
              </span>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line-soft pt-5 sm:grid-cols-3">
            <KeyValue label="Evidencias">
              {usage.files.evidenceCount.toLocaleString("es-CL")} · {formatBytes(usage.files.evidenceBytes)}
            </KeyValue>
            <KeyValue label="Logo">{usage.files.logoBytes ? formatBytes(usage.files.logoBytes) : "—"}</KeyValue>
            <KeyValue label="Base de datos">{formatBytes(usage.databaseBytes)}</KeyValue>
            <KeyValue label="Almacenamiento total" className="col-span-2 sm:col-span-3">
              {formatBytes(usage.storageBytes)}
            </KeyValue>
          </dl>
          {usage.cases.demo > 0 && (
            <p className="text-xs text-gray-500">Además tiene {usage.cases.demo} denuncias de ejemplo (no se cuentan).</p>
          )}
        </div>
      )}
    </Panel>
  );
}
