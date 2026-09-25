import { Link } from "react-router";
import { ROLE_LABELS, TONE_DOT, auditDetail, auditLabel, describeUserAgent } from "../lib/audit-labels";
import type { AuditEvent } from "../lib/types";
import { formatDate } from "../lib/ui-helpers";

/** Hace cuánto ocurrió: "hace 5 min", "hace 3 h" o la fecha. */
function timeAgo(value: string): string {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  if (seconds < 60) return "hace un momento";
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return formatDate(value, true);
}

/** Una línea de la bitácora: quién, qué, sobre qué y cuándo. */
export function AuditRow({
  event,
  compact = false,
  showTenant = true,
}: {
  event: AuditEvent;
  compact?: boolean;
  /** En el panel de una empresa no se muestra el enlace a la consola BeeHives. */
  showTenant?: boolean;
}) {
  const { label, tone } = auditLabel(event);
  const detail = auditDetail(event);
  const target = event.target_label && event.target_label !== event.actor_email ? event.target_label : null;

  return (
    <li className="flex gap-3 px-4 py-3.5 sm:px-6">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <p className="min-w-0 text-sm text-gray-900">
            <span className="font-medium">{label}</span>
            {target && <span className="text-gray-600"> · {target}</span>}
          </p>
          <time
            dateTime={event.occurred_at}
            title={formatDate(event.occurred_at, true)}
            className="shrink-0 text-xs text-gray-500"
          >
            {timeAgo(event.occurred_at)}
          </time>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
          <span className="truncate">
            {event.actor_email ?? "Sistema"}
            {event.actor_role && event.actor_role !== "global_admin" && (
              <span className="text-gray-400"> · como {ROLE_LABELS[event.actor_role] ?? event.actor_role}</span>
            )}
          </span>
          {showTenant && event.tenant_slug && (
            <>
              <span aria-hidden>·</span>
              <Link to={`/admin/tenants/${event.tenant_slug}`} className="font-mono text-highlight-text hover:underline">
                {event.tenant_slug}
              </Link>
            </>
          )}
          {!compact && event.ip && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">{event.ip}</span>
              <span aria-hidden>·</span>
              <span>{describeUserAgent(event.user_agent)}</span>
            </>
          )}
        </p>
        {!compact && detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
      </div>
    </li>
  );
}
