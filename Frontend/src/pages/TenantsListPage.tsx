import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  Breadcrumbs,
  Button,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  SearchInput,
  StatCard,
  StatusIndicator,
  td,
  th,
} from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import type { Tenant } from "../lib/types";
import { buttonClass, formatDate, initials } from "../lib/ui-helpers";

export function TenantsListPage() {
  const { token, logout } = useAdmin();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    api<{ tenants: Tenant[] }>("/admin/tenants", { token })
      .then((res) => {
        setTenants(res.tenants);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [token, logout, reloadKey]);

  const q = query.trim().toLowerCase();
  const visible = tenants?.filter((t) => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q)) ?? [];
  const count = (status: Tenant["status"]) => tenants?.filter((t) => t.status === status).length ?? "–";

  return (
    <>
      <Breadcrumbs items={[{ label: "Consola", to: "/admin" }, { label: "Empresas" }]} />
      <PageHeader
        title="Empresas"
        description="Organizaciones cliente de la plataforma. Cada empresa opera sobre una base de datos aislada y accede a su canal mediante una URL propia."
        actions={
          <Link to="/admin/tenants/new" className={buttonClass("primary", "w-full sm:w-auto")}>
            <Icon name="plus" />
            Crear empresa
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Registradas" value={tenants?.length ?? "–"} icon="building" />
        <StatCard label="Activas" value={count("active")} icon="success" tone="success" />
        <StatCard label="Suspendidas" value={count("suspended")} icon="error" tone="warning" />
      </div>

      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <Panel
        flush
        title="Listado de empresas"
        counter={tenants ? visible.length : undefined}
        actions={
          <Button onClick={() => setReloadKey((k) => k + 1)} aria-label="Actualizar" title="Actualizar" className="w-10 px-0">
            <Icon name="refresh" />
          </Button>
        }
        toolbar={<SearchInput value={query} onChange={setQuery} placeholder="Buscar por nombre o slug" />}
      >
        {tenants === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando empresas…</p>
        ) : tenants.length === 0 ? (
          <EmptyState
            title="No hay empresas"
            description="Aún no se ha registrado ninguna empresa en la plataforma."
            action={
              <Link to="/admin/tenants/new" className={buttonClass("normal")}>
                Crear empresa
              </Link>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState title="Sin coincidencias" description={`Ninguna empresa coincide con "${query}".`} />
        ) : (
          <>
            {/* Tabla (tablet y escritorio) */}
            <div className="relative hidden overflow-x-auto md:block">
              <table className="min-w-full">
                <thead className="border-b border-line-soft bg-gray-50/70">
                  <tr>
                    <th className={th}>Empresa</th>
                    <th className={th}>Estado</th>
                    <th className={th}>URL de acceso</th>
                    <th className={`${th} hidden xl:table-cell`}>Base de datos</th>
                    <th className={th}>Fecha de creación</th>
                    <th className={th}>
                      <span className="sr-only">Ver</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {visible.map((t) => (
                    <tr key={t.id} className="group transition hover:bg-gray-50/70">
                      <td className={td}>
                        <Link to={`/admin/tenants/${t.slug}`} className="flex items-center gap-3">
                          <TenantAvatar name={t.name} />
                          <span>
                            <span className="block font-medium text-gray-900 group-hover:text-accent">{t.name}</span>
                            <span className="block font-mono text-xs text-gray-500">{t.slug}</span>
                          </span>
                        </Link>
                      </td>
                      <td className={td}>
                        <StatusIndicator status={t.status} />
                      </td>
                      <td className={td}>
                        <a
                          href={`/${t.slug}/login`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-[13px] text-accent hover:underline"
                        >
                          /{t.slug}/login
                          <Icon name="external" className="size-3" />
                        </a>
                      </td>
                      <td className={`${td} hidden font-mono text-[13px] text-gray-500 xl:table-cell`}>{t.dbName}</td>
                      <td className={`${td} text-gray-500`}>{formatDate(t.createdAt)}</td>
                      <td className={`${td} w-px text-right`}>
                        <Link
                          to={`/admin/tenants/${t.slug}`}
                          aria-label={`Ver ${t.name}`}
                          className="inline-flex rounded-md p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Icon name="chevron" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (móvil) */}
            <ul className="divide-y divide-line-soft md:hidden">
              {visible.map((t) => (
                <li key={t.id}>
                  <Link to={`/admin/tenants/${t.slug}`} className="flex items-center gap-3 px-4 py-4 active:bg-gray-50">
                    <TenantAvatar name={t.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium text-gray-900">{t.name}</p>
                        <StatusIndicator status={t.status} />
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-gray-500">/{t.slug}/login</p>
                      <p className="mt-0.5 text-xs text-gray-400">Creada el {formatDate(t.createdAt)}</p>
                    </div>
                    <Icon name="chevron" className="size-4 shrink-0 text-gray-300" />
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

function TenantAvatar({ name }: { name: string }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-semibold text-gray-600 ring-1 ring-gray-200 ring-inset">
      {initials(name)}
    </span>
  );
}
