import { useEffect, useState } from "react";
import { AuditRow } from "../../components/AuditRow";
import { Alert, Breadcrumbs, Button, EmptyState, PageHeader, Panel, SearchInput } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import type { AuditEvent } from "../../lib/types";

interface Page {
  events: AuditEvent[];
  nextCursor: string | null;
}

/** Registro de accesos a denuncias: quién abrió cada caso, cuándo y con qué rol. Solo auditor. */
export function AccessLogPage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    api<Page>(`${apiBase}/cases/access-log${qs}`, { token })
      .then((res) => {
        setEvents(res.events);
        setCursor(res.nextCursor);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, query]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams({ before: cursor });
      if (query) p.set("q", query);
      const res = await api<Page>(`${apiBase}/cases/access-log?${p}`, { token });
      setEvents((prev) => [...(prev ?? []), ...res.events]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Registro de accesos" }]} />
      <PageHeader
        title="Registro de accesos"
        description="Cada vez que alguien abre una denuncia queda registrado: quién, con qué rol, cuándo y desde dónde. Permite detectar accesos indebidos."
      />
      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}
      <Panel
        flush
        title="Accesos a denuncias"
        toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Buscar por usuario, código de denuncia o IP" />}
      >
        {events === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando…</p>
        ) : events.length === 0 ? (
          <EmptyState title="Sin accesos registrados" description="Aún nadie ha abierto una denuncia." />
        ) : (
          <>
            <ul className="divide-y divide-line-soft">
              {events.map((e) => (
                <AuditRow key={e.id} event={e} showTenant={false} />
              ))}
            </ul>
            {cursor && (
              <div className="border-t border-line-soft px-4 py-4 text-center sm:px-6">
                <Button onClick={loadMore} loading={loadingMore} className="w-full sm:w-auto">
                  Cargar más
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
