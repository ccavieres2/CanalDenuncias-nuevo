import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Alert, Breadcrumbs, Button, Icon, PageHeader, Panel } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { brandStyle, contrastWithWhite, isHexColor } from "../../lib/branding";
import { useChannel } from "../../lib/channel-context";

interface AdminBranding {
  primaryColor: string | null;
  logoUrl: string | null;
}

const DEFAULT_COLOR = "#102574";
const MAX_BYTES = 300 * 1024;

/** Marca de la empresa: logo y color de su portal de denuncias, su pantalla de ingreso y su panel. */
export function ChannelBrandingPage() {
  const { token, apiBase, basePath, logout, tenant, refreshUser } = useChannel();
  const [branding, setBranding] = useState<AdminBranding | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [busy, setBusy] = useState<"color" | "logo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ branding: AdminBranding }>(`${apiBase}/console/branding`, { token })
      .then((res) => {
        setBranding(res.branding);
        setColor(res.branding.primaryColor ?? DEFAULT_COLOR);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout]);

  const valid = isHexColor(color);
  const contrast = valid ? contrastWithWhite(color) : 0;
  const readable = contrast >= 4.5;

  async function save(path: string, method: "PUT" | "DELETE", body: unknown, kind: "color" | "logo", message: string) {
    setBusy(kind);
    setError(null);
    setFlash(null);
    try {
      const res = await api<{ branding: AdminBranding }>(`${apiBase}/console/branding${path}`, { method, token, body });
      setBranding(res.branding);
      setColor(res.branding.primaryColor ?? DEFAULT_COLOR);
      setFlash(message);
      // Aplica la nueva marca al panel sin recargar la página.
      refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(null);
    }
  }

  function pickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setError("Sube una imagen PNG, JPG o WebP.");
    if (file.size > MAX_BYTES) return setError("El logo supera los 300 KB. Reduce su tamaño.");
    const reader = new FileReader();
    reader.onload = () => void save("/logo", "PUT", { dataUrl: reader.result }, "logo", "Logo actualizado.");
    reader.readAsDataURL(file);
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Marca" }]} />
      <PageHeader
        title="Marca"
        description="Logo y color de tu empresa en el portal de denuncias, la pantalla de ingreso y este panel. Solo afecta a tu empresa."
      />
      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}
      {flash && (
        <div className="mb-6">
          <Alert type="success">{flash}</Alert>
        </div>
      )}

      {!branding ? (
        <p className="py-16 text-center text-sm text-gray-500">Cargando…</p>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
          <div className="min-w-0 space-y-6">
            <Panel title="Logo" description="PNG, JPG o WebP de hasta 300 KB. Idealmente horizontal y con fondo transparente.">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex h-24 w-full items-center justify-center rounded-xl bg-gray-50 px-4 ring-1 ring-gray-200/70 ring-inset sm:w-64">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt="Logo actual" className="max-h-16 w-auto max-w-full object-contain" />
                  ) : (
                    <span className="text-sm text-gray-400">Sin logo</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} className="hidden" />
                  <Button onClick={() => fileRef.current?.click()} loading={busy === "logo"}>
                    <Icon name="plus" />
                    {branding.logoUrl ? "Cambiar logo" : "Subir logo"}
                  </Button>
                  {branding.logoUrl && (
                    <Button variant="danger" onClick={() => save("/logo", "DELETE", undefined, "logo", "Logo quitado.")}>
                      Quitar
                    </Button>
                  )}
                </div>
              </div>
            </Panel>

            <Panel title="Color principal" description="Botones, enlaces y elementos destacados. Debe ser lo bastante oscuro para que el texto blanco se lea.">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-800">Color</span>
                  <span className="mt-2 flex items-center gap-2">
                    <input
                      type="color"
                      value={valid ? color : DEFAULT_COLOR}
                      onChange={(e) => setColor(e.target.value)}
                      className="size-10 cursor-pointer rounded-lg border border-gray-300 bg-white p-1"
                      aria-label="Elegir color"
                    />
                    <input
                      value={color}
                      onChange={(e) => setColor(e.target.value.trim())}
                      maxLength={7}
                      className="h-10 w-32 rounded-lg border border-gray-300 px-3 font-mono text-sm uppercase outline-none focus:border-highlight focus:ring-4 focus:ring-highlight/20"
                      aria-label="Código del color"
                    />
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={!valid || !readable}
                    loading={busy === "color"}
                    onClick={() => save("", "PUT", { primaryColor: color }, "color", "Color actualizado.")}
                  >
                    Guardar color
                  </Button>
                  {branding.primaryColor && (
                    <Button onClick={() => save("", "PUT", { primaryColor: null }, "color", "Se restauraron los colores originales.")}>
                      Restaurar original
                    </Button>
                  )}
                </div>
              </div>
              {valid && !readable && (
                <p className="mt-3 text-sm text-amber-700">
                  Muy claro: el texto blanco tendría un contraste de {contrast.toFixed(1)}:1 y se necesita al menos 4,5:1. Elige un
                  tono más oscuro.
                </p>
              )}
              {!valid && <p className="mt-3 text-sm text-red-600">Usa el formato #RRGGBB.</p>}
            </Panel>
          </div>

          <aside className="xl:sticky xl:top-24">
            <Panel title="Vista previa" description="Así se verá el portal de denuncias.">
              <div className="overflow-hidden rounded-xl ring-1 ring-line" style={valid && readable ? brandStyle(color) : undefined}>
                <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
                  {branding.logoUrl && <img src={branding.logoUrl} alt="" className="h-8 w-auto max-w-[110px] object-contain" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-gray-900">{tenant.name}</span>
                    <span className="block text-xs text-gray-500">Canal de denuncias</span>
                  </span>
                </div>
                <div className="space-y-3 bg-canvas px-4 py-5">
                  <div className="rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white">Hacer una denuncia</div>
                  <div className="rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-line">
                    <span className="font-semibold text-highlight-text">Seguir mi denuncia</span>
                    <span className="mt-1 block h-1.5 w-2/3 rounded-full bg-highlight" />
                  </div>
                  <div className="rounded-lg bg-accent-soft px-4 py-2.5 text-xs text-gray-700">Opción seleccionada</div>
                </div>
              </div>
              <a
                href={`/${tenant.slug}/denuncias`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-highlight-text hover:underline"
              >
                Abrir el portal
                <Icon name="external" className="size-3.5" />
              </a>
            </Panel>
          </aside>
        </div>
      )}
    </>
  );
}
