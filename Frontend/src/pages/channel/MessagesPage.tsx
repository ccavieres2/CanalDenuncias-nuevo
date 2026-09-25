import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Breadcrumbs, EmptyState, Icon, PageHeader, Panel } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { type CaseSummary, STATUS } from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { formatDate } from "../../lib/ui-helpers";
import { DemoTag } from "./CasesPage";

interface Conversation {
  case: CaseSummary;
  total: number;
  unread: number;
  lastAt: string | null;
  lastSender: "reporter" | "staff" | null;
  lastBody: string | null;
  awaitingAck: boolean;
  canReply: boolean;
}

/** Bandeja del buzón seguro: conversaciones con los denunciantes de los casos a tu cargo. */
export function MessagesPage() {
  const { user, token, apiBase, basePath, logout } = useChannel();
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ conversations: Conversation[] }>(`${apiBase}/cases/messages`, { token })
      .then((res) => setItems(res.conversations))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, user.activeRole]);

  const unread = items?.reduce((n, c) => n + c.unread, 0) ?? 0;

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Mensajes" }]} />
      <PageHeader
        title="Mensajes"
        description="Buzón seguro con los denunciantes de tus casos. El denunciante responde desde el portal con su clave de seguimiento, incluso si es anónimo."
      />
      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <Panel flush title="Conversaciones" counter={items?.length}>
        {items === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando…</p>
        ) : items.length === 0 ? (
          <EmptyState
            title="Sin conversaciones"
            description="Cuando escribas a un denunciante o él te escriba desde el portal, la conversación aparecerá aquí."
          />
        ) : (
          <>
            {unread > 0 && (
              <p className="border-b border-line-soft bg-accent-soft px-4 py-2.5 text-sm font-medium text-highlight-text sm:px-6">
                {unread} {unread === 1 ? "mensaje nuevo" : "mensajes nuevos"} de denunciantes
              </p>
            )}
            <ul className="divide-y divide-line-soft">
              {items.map((c) => (
                <li key={c.case.id}>
                  <Link
                    to={`${basePath}/cases/${c.case.id}`}
                    className="flex items-start gap-4 px-4 py-4 transition hover:bg-gray-50/70 sm:px-6"
                  >
                    <span
                      className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
                        c.unread ? "bg-highlight text-white" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      <Icon name="mail" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-xs text-gray-500">{c.case.code}</span>
                        <Badge {...STATUS[c.case.status]} />
                        {c.case.isDemo && <DemoTag />}
                      </span>
                      <span className={`mt-1 block truncate text-sm ${c.unread ? "font-semibold text-gray-900" : "font-medium text-gray-900"}`}>
                        {c.case.subject}
                      </span>
                      {c.lastBody ? (
                        <span className="mt-0.5 block truncate text-sm text-gray-500">
                          {c.lastSender === "reporter" ? "Denunciante: " : "Tú / equipo: "}
                          {c.lastBody}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-sm text-amber-700">
                          Sin mensajes. Pendiente el acuse de recibo al denunciante.
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      {c.lastAt && <span className="text-xs text-gray-500">{formatDate(c.lastAt)}</span>}
                      {c.unread > 0 && (
                        <span className="rounded-full bg-highlight px-2 py-0.5 text-xs font-semibold text-white">{c.unread}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </>
  );
}
