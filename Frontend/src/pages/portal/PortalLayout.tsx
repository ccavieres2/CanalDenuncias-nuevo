import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router";
import { BrandLogo } from "../../components/Brand";
import { FullPageSpinner, Icon } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { brandStyle } from "../../lib/branding";
import type { PortalContext, PublicPortal } from "../../lib/portal";

/**
 * Portal público del denunciante de cada empresa: /:slug/denuncias. No requiere sesión.
 * Las denuncias quedan en la base de datos de esa empresa.
 */
export function PortalLayout() {
  const { slug = "" } = useParams();
  const [data, setData] = useState<PublicPortal | null>(null);
  const [missing, setMissing] = useState(false);
  const apiBase = `/t/${slug}/public`;
  const basePath = `/${slug}/denuncias`;

  useEffect(() => {
    api<PublicPortal>(`${apiBase}/portal`)
      .then((res) => {
        setData(res);
        document.title = `${res.portal.title} · ${res.company}`;
      })
      .catch((err) => setMissing(err instanceof ApiError && err.status === 404));
  }, [apiBase]);

  if (missing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4 text-center">
        <div>
          <p className="text-lg font-semibold text-gray-900">Canal no disponible</p>
          <p className="mt-1 text-sm text-gray-500">Revisa que la dirección esté bien escrita.</p>
        </div>
      </div>
    );
  }
  if (!data) return <FullPageSpinner />;

  const context: PortalContext = { slug, apiBase, basePath, data };

  return (
    <div className="flex min-h-screen flex-col bg-canvas" style={brandStyle(data.branding.primaryColor)}>
      <header className="border-t-4 border-b border-t-accent border-b-line bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6">
          <Link to={basePath} className="flex min-w-0 items-center gap-3">
            {data.branding.logoUrl && (
              <img src={data.branding.logoUrl} alt="" className="h-9 w-auto max-w-[140px] shrink-0 object-contain sm:h-10" />
            )}
            {/* En celular, si hay logo, basta con él. */}
            <span className={`min-w-0 ${data.branding.logoUrl ? "hidden sm:block" : ""}`}>
              <span className="block truncate text-base font-semibold tracking-tight text-gray-900 sm:text-lg">{data.company}</span>
              <span className="block truncate text-xs text-gray-500 sm:text-sm">{data.portal.title}</span>
            </span>
          </Link>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/15 ring-inset">
            <Icon name="lock" className="size-3.5" />
            <span className="hidden sm:inline">Conexión segura y confidencial</span>
            <span className="sm:hidden">Seguro</span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Outlet context={context} />
      </main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-gray-500 sm:flex-row sm:px-6">
          <p>No registramos tu dirección IP ni datos de tu dispositivo.</p>
          <span className="flex items-center gap-2">
            Canal operado con <BrandLogo tone="light" className="h-4" />
          </span>
        </div>
      </footer>
    </div>
  );
}
