import { type FormEvent, useEffect, useState } from "react";
import { Alert, Breadcrumbs, Button, Field, Icon, PageHeader, Panel, TextArea, Toggle } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import type { PortalSettings } from "../../lib/channel-types";

const POLICY_TEMPLATE = `1. Objetivo
Este canal permite a trabajadores, proveedores y terceros informar hechos que puedan constituir infracciones a la ley, al Reglamento Interno o al Código de Ética.

2. Qué se puede denunciar
Acoso laboral, acoso sexual y violencia en el trabajo (Ley 21.643), delitos de la Ley 20.393 y 21.595, conflictos de interés, discriminación y otras faltas a la normativa interna.

3. Confidencialidad y anonimato
La identidad del denunciante y el contenido de la denuncia se tratan con estricta reserva. Puedes denunciar de forma anónima; en ese caso, guarda tu código de seguimiento para conocer el estado y responder consultas.

4. Prohibición de represalias
Ninguna persona que denuncie de buena fe será objeto de represalias. Cualquier represalia será investigada y sancionada.

5. Procedimiento
Las denuncias son recibidas por personas designadas e independientes, que las investigan dentro de los plazos legales. Las denuncias de Ley Karin se investigan en un plazo máximo de 30 días hábiles y se informan a la Dirección del Trabajo.

6. Denuncias ante la autoridad
Las denuncias de Ley Karin también pueden presentarse directamente ante la Dirección del Trabajo.`;

export function ChannelPortalPage() {
  const { token, apiBase, basePath, logout, tenant } = useChannel();
  const [form, setForm] = useState<PortalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ portal: PortalSettings }>(`${apiBase}/console/settings`, { token })
      .then((res) => setForm(res.portal))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout]);

  const set = <K extends keyof PortalSettings>(key: K, value: PortalSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setFields({});
    setFlash(null);
    setSaving(true);
    try {
      const res = await api<{ portal: PortalSettings }>(`${apiBase}/console/settings/portal`, {
        method: "PUT",
        token,
        body: { ...form, contactEmail: form.contactEmail ?? "", reportEmail: form.reportEmail ?? "" },
      });
      setForm(res.portal);
      setFlash("Los cambios del portal se guardaron.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
    } finally {
      setSaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Portal del denunciante" }]} />
      <PageHeader
        title="Portal del denunciante"
        description="Lo que verá la persona que ingresa a denunciar: textos de bienvenida, política del canal y opciones de anonimato."
      />

      {(flash || error) && (
        <div className="mb-6 space-y-3">
          {flash && <Alert type="success">{flash}</Alert>}
          {error && <Alert>{error}</Alert>}
        </div>
      )}

      {!form ? (
        <p className="py-16 text-center text-sm text-gray-500">Cargando…</p>
      ) : (
        <form onSubmit={handleSubmit} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-6">
            <Panel title="Presentación">
              <div className="space-y-5">
                <Field
                  label="Título del portal"
                  required
                  value={form.title}
                  error={fields.title}
                  onChange={(e) => set("title", e.target.value)}
                />
                <TextArea
                  label="Mensaje de bienvenida"
                  rows={4}
                  value={form.welcome}
                  onChange={(e) => set("welcome", e.target.value)}
                  hint="Explica para qué sirve el canal y que se garantiza la confidencialidad y la no represalia."
                />
                <Field
                  label="Email de contacto del canal"
                  type="email"
                  placeholder="canal.etico@empresa.com"
                  value={form.contactEmail ?? ""}
                  error={fields.contactEmail}
                  hint="Opcional. Se muestra para consultas generales sobre el canal (no para denunciar)."
                  onChange={(e) => set("contactEmail", e.target.value)}
                />
              </div>
            </Panel>

            <Panel
              title="Otras vías para denunciar"
              description="Se muestran en el portal. Las denuncias que lleguen por estas vías las registra el gestor en «Registrar denuncia»."
            >
              <div className="space-y-5">
                <Field
                  label="En persona"
                  placeholder="Ej.: Oficina de Personas, piso 3, con Carla Soto"
                  value={form.inPerson ?? ""}
                  maxLength={200}
                  error={fields.inPerson}
                  onChange={(e) => set("inPerson", e.target.value)}
                />
                <div className="grid gap-5 md:grid-cols-2">
                  <Field
                    label="Teléfono"
                    placeholder="+56 2 2345 6789"
                    value={form.phone ?? ""}
                    maxLength={40}
                    error={fields.phone}
                    onChange={(e) => set("phone", e.target.value)}
                  />
                  <Field
                    label="Correo para denuncias"
                    type="email"
                    placeholder="denuncias@empresa.com"
                    value={form.reportEmail ?? ""}
                    error={fields.reportEmail}
                    onChange={(e) => set("reportEmail", e.target.value)}
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Opcionales. La vía ante la Dirección del Trabajo (Ley Karin) se informa siempre.
                </p>
              </div>
            </Panel>

            <Panel title="Anonimato">
              <Toggle
                label="Permitir denuncias anónimas"
                description="Recomendado. La Ley 21.595 y las buenas prácticas (ISO 37002) esperan que el canal permita denunciar sin identificarse. El denunciante recibe un código para seguir su caso. No aplica a Ley Karin: la Dirección del Trabajo exige identificar a la persona afectada."
                checked={form.allowAnonymous}
                onChange={(v) => set("allowAnonymous", v)}
              />
              {!form.allowAnonymous && (
                <div className="mt-4">
                  <Alert type="info">
                    Sin anonimato, algunas personas podrían no denunciar por temor. Evalúalo con tu área legal.
                  </Alert>
                </div>
              )}
            </Panel>

            <Panel
              title="Política del canal"
              description="Documento que el denunciante puede leer antes de denunciar: alcance, confidencialidad, no represalias y procedimiento."
              actions={
                <Button
                  type="button"
                  onClick={() => {
                    if (!form.policy.trim() || window.confirm("¿Reemplazar el texto actual por la plantilla?")) {
                      set("policy", POLICY_TEMPLATE);
                    }
                  }}
                >
                  <Icon name="copy" />
                  Usar plantilla
                </Button>
              }
            >
              <TextArea
                label="Texto de la política"
                rows={16}
                value={form.policy}
                onChange={(e) => set("policy", e.target.value)}
                hint="La plantilla es un punto de partida: revísala con tu área legal y ajústala a tu Reglamento Interno."
              />
            </Panel>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saving} className="w-full sm:w-auto">
                Guardar cambios
              </Button>
            </div>
          </div>

          <aside className="space-y-3 xl:sticky xl:top-24">
            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Vista previa</p>
            <div className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
              <div className="bg-nav px-6 py-5">
                <p className="text-xs font-medium tracking-wide text-white/60 uppercase">{tenant.name}</p>
                <p className="mt-1 text-lg font-semibold text-white">{form.title || "Canal de denuncias"}</p>
              </div>
              <div className="space-y-5 px-6 py-5">
                <p className="text-sm leading-relaxed whitespace-pre-line text-gray-600">
                  {form.welcome || "Mensaje de bienvenida…"}
                </p>
                <div className="space-y-2">
                  <div className="flex h-11 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white">
                    Hacer una denuncia
                  </div>
                  <div className="flex h-11 items-center justify-center rounded-lg text-sm font-semibold text-gray-800 ring-1 ring-gray-300 ring-inset">
                    Seguir mi denuncia
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2">
                    <Icon name="lock" className="size-4 text-highlight-text" />
                    Confidencial
                  </li>
                  {form.allowAnonymous && (
                    <li className="flex items-center gap-2">
                      <Icon name="user" className="size-4 text-highlight-text" />
                      Puedes denunciar de forma anónima
                    </li>
                  )}
                  <li className="flex items-center gap-2">
                    <Icon name="shield" className="size-4 text-highlight-text" />
                    Protección contra represalias
                  </li>
                </ul>
                {form.contactEmail && <p className="text-xs text-gray-500">Consultas: {form.contactEmail}</p>}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-white px-4 py-4 shadow-card">
              <p className="text-sm font-medium text-gray-900">Dirección pública del canal</p>
              <p className="mt-1 text-xs text-gray-500">Publícala en tu intranet, sitio web o afiches. No requiere cuenta.</p>
              <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs break-all text-gray-800 ring-1 ring-gray-200/70 ring-inset">
                {`${window.location.origin}/${tenant.slug}/denuncias`}
              </p>
              <a
                href={`/${tenant.slug}/denuncias`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-highlight-text hover:underline"
              >
                Abrir el portal
                <Icon name="external" className="size-3.5" />
              </a>
            </div>
          </aside>
        </form>
      )}
    </>
  );
}
