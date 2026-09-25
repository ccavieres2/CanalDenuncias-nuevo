import { useEffect, useState } from "react";
import { AuditRow } from "../components/AuditRow";
import { Alert, Breadcrumbs, Button, EmptyState, PageHeader, Panel, SearchInput, Select } from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import { AUDIT_CATEGORIES } from "../lib/audit-labels";
import type { AuditEvent, Tenant } from "../lib/types";

interface Page {
  events: AuditEvent[];
  nextCursor: string | null;
}

const PAGE_SIZE = 50;

interface Filters {
  category: string;
  tenant: string;
  query: string;
}

function buildQuery({ category, tenant, query }: Filters, before?: string | null): string {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (category) p.set("action", category);
  if (tenant) p.set("tenant", tenant);
  if (query) p.set("q", query);
  if (before) p.set("before", before);
  return p.toString();
}

export function AuditPage() {
  const { token, logout } = useAdmin();
  const [category, setCategory] = useState("");
  const [tenant, setTenant] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La búsqueda por texto espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    api<{ tenants: Tenant[] }>("/admin/tenants", { token })
      .then((res) => setTenants(res.tenants))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    api<Page>(`/admin/audit?${buildQuery({ category, tenant, query })}`, { token })
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
  }, [token, logout, category, tenant, query]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api<Page>(`/admin/audit?${buildQuery({ category, tenant, query }, cursor)}`, { token });
      setEvents((prev) => [...(prev ?? []), ...res.events]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = Boolean(category || tenant || query);

  return (
    <>
      <Breadcrumbs items={[{ label: "Consola", to: "/admin" }, { label: "Auditoría" }]} />
      <PageHeader
        title="Auditoría"
        description="Registro inalterable de los accesos y de cada acción realizada en la plataforma: quién, qué, cuándo y desde dónde."
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_240px_240px]">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar por usuario, objetivo o IP" />
            <Select value={category} onChange={setCategory} aria-label="Tipo de acción">
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Select value={tenant} onChange={setTenant} aria-label="Empresa">
              <option value="">Todas las empresas</option>
              {tenants.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
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
            title={filtered ? "Sin resultados" : "Sin eventos"}
            description={filtered ? "Ningún evento coincide con los filtros." : "Todavía no hay actividad registrada."}
          />
        ) : (
          <>
            <ul className="divide-y divide-line-soft">
              {events.map((e) => (
                <AuditRow key={e.id} event={e} />
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
