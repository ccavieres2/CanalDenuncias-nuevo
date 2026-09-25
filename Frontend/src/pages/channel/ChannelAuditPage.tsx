import { useEffect, useState } from "react";
import { AuditRow } from "../../components/AuditRow";
import { Alert, Breadcrumbs, Button, EmptyState, PageHeader, Panel, SearchInput, Select } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { CHANNEL_AUDIT_CATEGORIES } from "../../lib/audit-labels";
import { useChannel } from "../../lib/channel-context";
import type { AuditEvent } from "../../lib/types";

interface Page {
  events: AuditEvent[];
  nextCursor: string | null;
}

const PAGE_SIZE = 50;

function buildQuery(category: string, query: string, before?: string | null): string {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (category) p.set("action", category);
  if (query) p.set("q", query);
  if (before) p.set("before", before);
  return p.toString();
}

/** Auditoría del canal: accesos y cambios de configuración de esta empresa. */
export function ChannelAuditPage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    api<Page>(`${apiBase}/console/audit?${buildQuery(category, query)}`, { token })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events);
        setCursor(res.nextCursor);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, token, logout, category, query]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api<Page>(`${apiBase}/console/audit?${buildQuery(category, query, cursor)}`, { token });
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
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Auditoría" }]} />
      <PageHeader
        title="Auditoría"
        description="Registro inalterable de los accesos al canal y de cada cambio en su configuración: quién, qué, cuándo y desde dónde."
      />

      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <Panel
        flush
        title="Eventos"
        toolbar={
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar por usuario, objetivo o IP" />
            <Select value={category} onChange={setCategory} aria-label="Tipo de acción">
              {CHANNEL_AUDIT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {events === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando eventos…</p>
        ) : events.length === 0 ? (
          <EmptyState
            title={category || query ? "Sin resultados" : "Sin eventos"}
            description={category || query ? "Ningún evento coincide con los filtros." : "Todavía no hay actividad registrada."}
          />
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
                  Cargar más eventos
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
