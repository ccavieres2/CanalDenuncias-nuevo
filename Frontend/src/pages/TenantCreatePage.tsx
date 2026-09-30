import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Breadcrumbs, Button, Field, Icon, PageHeader, Panel, TextArea } from "../components/ui";
import { PlanPicker } from "../components/PlanPicker";
import { useAdmin } from "../lib/admin-context";
import { usePlans } from "../lib/plans";
import { ApiError, api } from "../lib/api";
import type { Credentials, Tenant } from "../lib/types";
import { buttonClass, initials } from "../lib/ui-helpers";

/** "Upshield S.A." -> "upshield-s-a" */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const EMPTY_PROFILE = { legalName: "", taxId: "", contactName: "", contactEmail: "", contactPhone: "", notes: "" };

export function TenantCreatePage() {
  const { token, logout } = useAdmin();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [planId, setPlanId] = useState("");
  const { plans, error: plansError } = usePlans(token, logout);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const setField = (key: keyof typeof EMPTY_PROFILE) => (value: string) => setProfile((p) => ({ ...p, [key]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setLoading(true);
    try {
      const res = await api<{ tenant: Tenant; credentials: Credentials }>("/admin/tenants", {
        method: "POST",
        token,
        body: { name, slug, planId, ...profile, admin: { name: adminName, email: adminEmail } },
      });
      navigate(`/admin/tenants/${res.tenant.slug}`, {
        state: { flash: `La empresa "${res.tenant.name}" se creó correctamente.`, credentials: res.credentials },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return logout();
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      setLoading(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const shownSlug = slug || "slug";

  return (
    <>
      <Breadcrumbs
        items={[{ label: "Consola", to: "/admin" }, { label: "Empresas", to: "/admin/tenants" }, { label: "Crear empresa" }]}
      />
      <PageHeader
        title="Crear empresa"
        description="Registra una nueva organización cliente. Se le aprovisionará una base de datos dedicada y se creará su primer administrador."
      />

      <form
        onSubmit={handleSubmit}
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]"
      >
        {/* Formulario */}
        <div className="min-w-0 space-y-6">
          {error && <Alert>{error}</Alert>}
          {plansError && <Alert>{plansError}</Alert>}

          <div className="grid items-start gap-6 2xl:grid-cols-2">
            <Panel title="Datos de la empresa" description="Cómo se identificará la organización en la plataforma.">
              <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-1">
                <Field
                  label="Nombre"
                  description="Nombre visible de la organización."
                  required
                  autoFocus
                  placeholder="Upshield"
                  value={name}
                  error={fields.name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                />
                <Field
                  label="Slug"
                  description="Identificador único en la URL. No se puede cambiar después."
                  required
                  mono
                  placeholder="upshield"
                  value={slug}
                  error={fields.slug}
                  hint="Minúsculas, números y guiones (2 a 40)."
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
              </div>
            </Panel>

            <Panel title="Administrador de la empresa" description="Usuario client_admin que gestionará el canal.">
              <div className="grid gap-5">
                <Field
                  label="Nombre completo"
                  required
                  placeholder="Ana Pérez"
                  value={adminName}
                  error={fields["admin.name"]}
                  onChange={(e) => setAdminName(e.target.value)}
                />
                <Field
                  label="Correo electrónico"
                  type="email"
                  required
                  placeholder="ana@empresa.com"
                  value={adminEmail}
                  error={fields["admin.email"]}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
                <p className="flex items-start gap-2 text-sm text-gray-500">
                  <Icon name="key" className="mt-0.5 size-4 shrink-0 text-gray-400" />
                  Se generará una contraseña temporal segura. Al ingresar deberá cambiarla y configurar la verificación
                  en dos pasos.
                </p>
              </div>
            </Panel>

            <div className="2xl:col-span-2">
              <Panel
                title="Plan"
                description="Define qué marcos legales, módulos y límites tendrá la empresa. Se puede cambiar después."
              >
                <PlanPicker plans={plans} value={planId} onChange={setPlanId} error={fields.planId} />
              </Panel>
            </div>

            <div className="2xl:col-span-2">
              <Panel
                title="Información comercial"
                description="Opcional. Datos de facturación y de la persona de contacto en la empresa."
              >
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  <Field
                    label="Razón social"
                    placeholder="Upshield SpA"
                    value={profile.legalName}
                    error={fields.legalName}
                    onChange={(e) => setField("legalName")(e.target.value)}
                  />
                  <Field
                    label="RUT"
                    placeholder="76.123.456-7"
                    value={profile.taxId}
                    error={fields.taxId}
                    onChange={(e) => setField("taxId")(e.target.value)}
                  />
                  <Field
                    label="Persona de contacto"
                    value={profile.contactName}
                    error={fields.contactName}
                    onChange={(e) => setField("contactName")(e.target.value)}
                  />
                  <Field
                    label="Email de contacto"
                    type="email"
                    value={profile.contactEmail}
                    error={fields.contactEmail}
                    onChange={(e) => setField("contactEmail")(e.target.value)}
                  />
                  <Field
                    label="Teléfono de contacto"
                    type="tel"
                    placeholder="+56 9 1234 5678"
                    value={profile.contactPhone}
                    error={fields.contactPhone}
                    onChange={(e) => setField("contactPhone")(e.target.value)}
                  />
                  <div className="sm:col-span-2 xl:col-span-3">
                    <TextArea
                      label="Notas internas"
                      placeholder="Plan contratado, condiciones, observaciones… (solo visible para BeeHives)"
                      value={profile.notes}
                      onChange={(e) => setField("notes")(e.target.value)}
                    />
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>

        {/* Resumen y acciones */}
        <aside className="lg:sticky lg:top-24">
          <section className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
            <div className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
                {name.trim() ? initials(name) : <Icon name="building" className="size-5" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-gray-900">{name.trim() || "Nueva empresa"}</p>
                <p className="text-sm text-gray-500">Resumen</p>
              </div>
            </div>

            <dl className="divide-y divide-line-soft">
              <SummaryRow label="URL de acceso" mono>
                /{shownSlug}/login
              </SummaryRow>
              <SummaryRow label="Base de datos" mono>
                tenant_{shownSlug.replace(/-/g, "_")}
              </SummaryRow>
              <SummaryRow label="Administrador">{adminEmail.trim() || "—"}</SummaryRow>
            </dl>

            <div className="border-t border-line-soft bg-gray-50/70 px-5 py-4">
              <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">Al crear la empresa</p>
              <ol className="mt-3 space-y-2.5 text-sm text-gray-600">
                {[
                  "Se crea su base de datos dedicada",
                  "Se aplica la estructura inicial",
                  "Se registra el administrador con una contraseña temporal",
                  "En su primer ingreso la cambiará y configurará la verificación en dos pasos",
                ].map((text, i) => (
                  <li key={text} className="flex gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-highlight-text ring-1 ring-line">
                      {i + 1}
                    </span>
                    {text}
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-col gap-2 border-t border-line-soft px-5 py-4">
              <Button type="submit" variant="primary" loading={loading} className="h-11 w-full">
                {loading ? "Aprovisionando…" : "Crear empresa"}
              </Button>
              <Link to="/admin/tenants" className={buttonClass("link", "w-full")}>
                Cancelar
              </Link>
            </div>
          </section>
        </aside>
      </form>
    </>
  );
}

function SummaryRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="px-5 py-3.5">
      <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</dt>
      <dd className={`mt-1 truncate text-sm text-gray-900 ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}
