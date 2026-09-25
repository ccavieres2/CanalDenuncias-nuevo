import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Breadcrumbs, Button, Field, Icon, PageHeader, Panel, Select, TextArea } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { CHANNEL_LABEL, type CaseOrigin, type OriginChannel } from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { FRAMEWORKS, FRAMEWORK_ORDER, type LegalFramework } from "../../lib/roles";
import { formatRut, isValidRut } from "../../lib/rut";

type Origin = Exclude<CaseOrigin, "portal">;
type Involved = { name: string; relation: "Persona denunciada" | "Testigo" | "Otra persona involucrada" };
type IconName = Parameters<typeof Icon>[0]["name"];

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

/** Vías por las que puede llegar una denuncia además del portal. */
const ORIGIN_GROUPS: { title: string; items: { value: Origin; title: string; text: string; icon: IconName }[] }[] = [
  {
    title: "Recibida por la empresa",
    items: [
      {
        value: "direct",
        title: "Directamente",
        text: "En persona (con acta), por carta, correo, teléfono o a través de jefatura, sindicato o comité paritario.",
        icon: "user",
      },
      {
        value: "other_company",
        title: "Remitida por otra empresa",
        text: "Subcontratación o servicios transitorios: la empresa principal, contratista o usuaria la remite.",
        icon: "building",
      },
      {
        value: "internal",
        title: "Detectada internamente",
        text: "Por auditoría, el Encargado de Prevención de Delitos, controles o monitoreo, sin denunciante.",
        icon: "search",
      },
    ],
  },
  {
    title: "Notificada por una autoridad",
    items: [
      { value: "dt", title: "Dirección del Trabajo", text: "Denuncia Ley Karin presentada ante la DT. La investiga la DT.", icon: "building" },
      { value: "court", title: "Tribunal", text: "Demanda de tutela laboral u otra acción judicial notificada a la empresa.", icon: "book" },
      { value: "agency", title: "Agencia de Protección de Datos", text: "Reclamo de un titular por sus datos personales (Ley 21.719).", icon: "lock" },
      { value: "prosecutor", title: "Ministerio Público o policías", text: "Requerimiento de información o investigación penal (Ley 20.393).", icon: "shield" },
      { value: "other_authority", title: "Otra autoridad", text: "SUSESO, CMF, SERNAC, superintendencias u otro organismo.", icon: "building" },
    ],
  },
];

const WITH_REPORTER: Origin[] = ["direct", "other_company"];
const AUTHORITY: Origin[] = ["court", "agency", "prosecutor", "other_authority"];

const DETAIL_LABEL: Record<Origin, { label: string; placeholder: string }> = {
  direct: { label: "Quién la recibió", placeholder: "Ej.: Carla Soto, jefa de Personas" },
  other_company: { label: "Quién la remitió", placeholder: "Ej.: Encargado de cumplimiento de la empresa principal" },
  internal: { label: "Cómo se detectó", placeholder: "Ej.: auditoría de compras del segundo trimestre" },
  dt: { label: "N° de denuncia o ticket de la DT", placeholder: "Ej.: 1301/2026/1234" },
  court: { label: "Tribunal y RIT", placeholder: "Ej.: 2° Juzgado de Letras del Trabajo de Santiago, T-1234-2026" },
  agency: { label: "N° de reclamo", placeholder: "N° asignado por la Agencia" },
  prosecutor: { label: "Fiscalía y RUC", placeholder: "Ej.: Fiscalía Centro Norte, RUC 2600123456-7" },
  other_authority: { label: "Autoridad y N° de oficio", placeholder: "Ej.: SUSESO, oficio N° 1234" },
};

/** El gestor registra una denuncia que no llegó por el portal. */
export function RegisterCasePage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [categories, setCategories] = useState<{ id: string; name: string; framework: LegalFramework }[] | null>(null);
  const [origin, setOrigin] = useState<Origin>("direct");
  const [channel, setChannel] = useState<OriginChannel | "">("verbal");
  const [form, setForm] = useState({
    receivedDate: today(),
    originDetail: "",
    externalDueDate: "",
    otherCompany: "",
    categoryId: "",
    subject: "",
    description: "",
    occurredWhen: "",
    occurredWhere: "",
  });
  const [companyRelation, setCompanyRelation] = useState<"contractor" | "principal" | "">("");
  const [involved, setInvolved] = useState<Involved[]>([]);
  const [anonymous, setAnonymous] = useState(false);
  const [reporter, setReporter] = useState({ name: "", email: "", phone: "", rut: "" });
  const [isAffected, setIsAffected] = useState(true);
  const [affected, setAffected] = useState({ name: "", rut: "", email: "" });
  const [representation, setRepresentation] = useState("");
  const [requestsDt, setRequestsDt] = useState(false);
  const [issueKey, setIssueKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ id: string; code: string; trackingKey: string | null } | null>(null);

  useEffect(() => {
    api<{ categories: { id: string; name: string; framework: LegalFramework }[] }>(`${apiBase}/cases/register-options`, { token })
      .then((res) => setCategories(res.categories))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout]);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const category = categories?.find((c) => c.id === form.categoryId);
  const karin = category?.framework === "ley_karin";
  const withReporter = WITH_REPORTER.includes(origin);
  // Ley Karin con denunciante: identificación obligatoria (Ord. DT 497/21).
  const karinId = karin && withReporter;
  // Categorías posibles según quién notificó.
  const selectable =
    categories?.filter((c) =>
      origin === "dt" ? c.framework === "ley_karin" : origin === "agency" ? c.framework === "ley_21719" : true,
    ) ?? [];

  function changeOrigin(o: Origin) {
    setOrigin(o);
    setFields({});
    setForm((f) => ({ ...f, categoryId: "", externalDueDate: "", originDetail: "" }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (karinId && isAffected && !isValidRut(reporter.rut)) errs["reporter.rut"] = reporter.rut ? "RUN inválido" : "El RUN es obligatorio en Ley Karin";
    if (karinId && !isAffected && !isValidRut(affected.rut)) errs["affected.rut"] = "RUN inválido o faltante";
    if (reporter.rut && !isValidRut(reporter.rut)) errs["reporter.rut"] = "RUN inválido";
    setFields(errs);
    if (Object.keys(errs).length) {
      setError("Revisa los campos marcados.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const anon = withReporter ? anonymous && !karinId : true;
      const res = await api<{ id: string; code: string; trackingKey: string | null }>(`${apiBase}/cases`, {
        method: "POST",
        token,
        body: {
          origin,
          originChannel: origin === "direct" ? channel || undefined : undefined,
          receivedDate: form.receivedDate,
          originDetail: form.originDetail,
          externalDueDate: AUTHORITY.includes(origin) ? form.externalDueDate || undefined : undefined,
          companyRelation: origin === "other_company" ? companyRelation || undefined : undefined,
          otherCompany: origin === "other_company" ? form.otherCompany : undefined,
          categoryId: form.categoryId,
          subject: form.subject,
          description: form.description,
          occurredWhen: form.occurredWhen,
          occurredWhere: form.occurredWhere,
          involved: involved.filter((p) => p.name.trim()),
          anonymous: anon,
          reporter: anon ? undefined : reporter,
          reporterIsAffected: !karinId || isAffected,
          affected: karinId && !isAffected ? affected : undefined,
          representation: karinId && !isAffected ? representation : undefined,
          reporterRequestsDt: karin && withReporter && requestsDt,
          issueKey: withReporter && issueKey,
        },
      });
      setResult(res);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields ?? {});
        setError(err.fields ? Object.values(err.fields).join(". ") : err.message);
      } else setError("Error inesperado");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  const crumbs = [
    { label: "Inicio", to: basePath },
    { label: "Bandeja de denuncias", to: `${basePath}/cases` },
    { label: "Registrar denuncia" },
  ];

  if (result) {
    return (
      <>
        <Breadcrumbs items={crumbs} />
        <Panel>
          <div className="mx-auto max-w-xl py-4 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Icon name="success" className="size-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold text-gray-900">Denuncia {result.code} registrada</h1>
            {result.trackingKey ? (
              <>
                <p className="mt-2 text-sm text-gray-600">
                  Entrega esta clave al denunciante (junto con la copia del acta, si fue verbal). Con ella sigue su caso y conversa
                  con el equipo en el portal de denuncias. Se muestra una sola vez.
                </p>
                <p className="mt-5 rounded-xl bg-accent-soft px-4 py-4 font-mono text-xl font-semibold tracking-wider break-all text-gray-900 ring-1 ring-highlight/20 ring-inset">
                  {result.trackingKey}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-600">
                {origin === "dt"
                  ? "La investiga la Dirección del Trabajo. Adopta de inmediato las medidas de resguardo que pidió y registra su informe cuando llegue."
                  : "Revisa en la ficha los plazos que corresponden a este caso."}
              </p>
            )}
            <Link
              to={`${basePath}/cases/${result.id}`}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Abrir la denuncia
            </Link>
          </div>
        </Panel>
      </>
    );
  }

  const detail = DETAIL_LABEL[origin];

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <PageHeader
        title="Registrar denuncia"
        description="Para denuncias que no llegaron por el portal: recibidas por la empresa por otra vía o notificadas por una autoridad."
      />
      <form onSubmit={submit} noValidate className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {error && <Alert>{error}</Alert>}

          <Panel title="¿Cómo llegó?">
            <div className="space-y-5">
              {ORIGIN_GROUPS.map((g) => (
                <fieldset key={g.title}>
                  <legend className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">{g.title}</legend>
                  <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                    {g.items.map((o) => (
                      <label
                        key={o.value}
                        className={`flex cursor-pointer gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset transition ${
                          origin === o.value ? "bg-accent-soft ring-2 ring-highlight" : "ring-line hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="origin"
                          checked={origin === o.value}
                          onChange={() => changeOrigin(o.value)}
                          className="mt-1 accent-[var(--color-highlight)]"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                            <Icon name={o.icon} className="size-3.5 text-gray-500" />
                            {o.title}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{o.text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            <div className="mt-6 grid gap-5 border-t border-line-soft pt-5 md:grid-cols-2">
              {origin === "direct" && (
                <label className="block md:col-span-2">
                  <span className="block text-sm font-medium text-gray-800">Medio</span>
                  <div className="mt-2">
                    <Select value={channel} onChange={(v) => setChannel(v as OriginChannel)}>
                      {(Object.keys(CHANNEL_LABEL) as OriginChannel[]).map((k) => (
                        <option key={k} value={k}>
                          {CHANNEL_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {channel === "verbal" && (
                    <span className="mt-1.5 block text-sm text-gray-500">
                      Deja la denuncia por escrito en un acta, fírmala con la persona y entrégale una copia.
                    </span>
                  )}
                </label>
              )}
              {origin === "other_company" && (
                <>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-800">Esa empresa es</span>
                    <div className="mt-2">
                      <Select value={companyRelation} onChange={(v) => setCompanyRelation(v as "contractor" | "principal")}>
                        <option value="">Selecciona</option>
                        <option value="principal">La empresa principal o usuaria</option>
                        <option value="contractor">Una contratista o subcontratista</option>
                      </Select>
                    </div>
                  </label>
                  <Field
                    label="Nombre de la empresa"
                    value={form.otherCompany}
                    maxLength={150}
                    error={fields.otherCompany}
                    onChange={(e) => set("otherCompany")(e.target.value)}
                  />
                </>
              )}
              <Field
                label={origin === "internal" ? "Fecha en que se detectó" : AUTHORITY.includes(origin) || origin === "dt" ? "Fecha de notificación" : "Fecha de recepción"}
                type="date"
                max={today()}
                required
                value={form.receivedDate}
                onChange={(e) => set("receivedDate")(e.target.value)}
                hint="Los plazos se cuentan desde esta fecha."
              />
              <Field
                label={detail.label}
                value={form.originDetail}
                onChange={(e) => set("originDetail")(e.target.value)}
                maxLength={300}
                placeholder={detail.placeholder}
              />
              {AUTHORITY.includes(origin) && (
                <Field
                  label="Plazo para responder (si la autoridad lo fijó)"
                  type="date"
                  min={form.receivedDate}
                  value={form.externalDueDate}
                  error={fields.externalDueDate}
                  onChange={(e) => set("externalDueDate")(e.target.value)}
                  hint={origin === "court" ? "Coordina la respuesta con tu asesoría legal." : "Aparecerá como hito con este vencimiento."}
                />
              )}
            </div>
          </Panel>

          <Panel title="La denuncia">
            <div className="space-y-5">
              <label className="block">
                <span className="block text-sm font-medium text-gray-800">Categoría</span>
                <div className="mt-2">
                  <Select value={form.categoryId} onChange={set("categoryId")} required>
                    <option value="">Selecciona la categoría</option>
                    {FRAMEWORK_ORDER.map((fw) => {
                      const items = selectable.filter((c) => c.framework === fw);
                      return items.length ? (
                        <optgroup key={fw} label={FRAMEWORKS[fw].label}>
                          {items.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null;
                    })}
                  </Select>
                </div>
                {origin === "dt" && <span className="mt-1.5 block text-sm text-gray-500">La DT notifica denuncias de Ley Karin.</span>}
                {origin === "agency" && <span className="mt-1.5 block text-sm text-gray-500">Los reclamos de la Agencia son de datos personales.</span>}
                {fields.categoryId && <span className="mt-1.5 block text-sm text-red-600">{fields.categoryId}</span>}
              </label>
              <Field label="Título" required maxLength={150} value={form.subject} onChange={(e) => set("subject")(e.target.value)} />
              <TextArea
                label={
                  origin === "direct" && channel === "verbal"
                    ? "Acta de la denuncia"
                    : origin === "internal"
                      ? "Hallazgo"
                      : withReporter
                        ? "Relato de la denuncia"
                        : "Hechos según la autoridad"
                }
                required
                rows={7}
                value={form.description}
                onChange={(e) => set("description")(e.target.value)}
              />
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Cuándo ocurrió" value={form.occurredWhen} onChange={(e) => set("occurredWhen")(e.target.value)} maxLength={200} />
                <Field label="Dónde ocurrió" value={form.occurredWhere} onChange={(e) => set("occurredWhere")(e.target.value)} maxLength={200} />
              </div>
            </div>
          </Panel>

          <Panel title="Personas involucradas">
            <div className="space-y-3">
              {involved.map((p, i) => (
                <div key={i} className="grid gap-3 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200/70 ring-inset md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
                  <Field
                    label="Nombre o cargo"
                    value={p.name}
                    maxLength={150}
                    onChange={(e) => setInvolved((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-800">Relación</span>
                    <div className="mt-2">
                      <Select value={p.relation} onChange={(v) => setInvolved((l) => l.map((x, j) => (j === i ? { ...x, relation: v as Involved["relation"] } : x)))}>
                        <option>Persona denunciada</option>
                        <option>Testigo</option>
                        <option>Otra persona involucrada</option>
                      </Select>
                    </div>
                  </label>
                  <Button type="button" variant="link" className="h-10 px-2 text-gray-500" onClick={() => setInvolved((l) => l.filter((_, j) => j !== i))}>
                    Quitar
                  </Button>
                </div>
              ))}
              <Button type="button" onClick={() => setInvolved((l) => [...l, { name: "", relation: "Persona denunciada" }])}>
                <Icon name="plus" />
                Agregar persona
              </Button>
            </div>
          </Panel>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24">
          <Panel title={withReporter ? "Denunciante" : "Denunciante o afectado"}>
            {!withReporter ? (
              <p className="text-sm text-gray-600">
                {origin === "internal"
                  ? "Caso detectado internamente: no hay denunciante."
                  : "Los datos de la persona los maneja la autoridad. Si los informó, inclúyelos en los hechos."}
              </p>
            ) : (
              <div className="space-y-4">
                {karinId ? (
                  <>
                    <p className="rounded-lg bg-violet-50 px-3.5 py-3 text-xs text-violet-900 ring-1 ring-violet-600/15 ring-inset">
                      Ley Karin: la persona afectada debe identificarse con nombre, RUN y correo personal (art. 11 DS 21/2024).
                    </p>
                    <div className="flex gap-4 text-sm text-gray-800">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="radio" checked={isAffected} onChange={() => setIsAffected(true)} className="accent-[var(--color-highlight)]" />
                        Es la persona afectada
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="radio" checked={!isAffected} onChange={() => setIsAffected(false)} className="accent-[var(--color-highlight)]" />
                        La representa
                      </label>
                    </div>
                  </>
                ) : (
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-800">
                    <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="size-4 accent-[var(--color-highlight)]" />
                    Anónima o sin datos del denunciante
                  </label>
                )}
                {(karinId || !anonymous) && (
                  <>
                    <Field label="Nombre" required value={reporter.name} maxLength={150} error={fields["reporter.name"]} onChange={(e) => setReporter({ ...reporter, name: e.target.value })} />
                    <Field
                      label={karinId && isAffected ? "RUN" : "RUN (opcional)"}
                      value={reporter.rut}
                      placeholder="12.345.678-5"
                      maxLength={12}
                      error={fields["reporter.rut"]}
                      onChange={(e) => setReporter({ ...reporter, rut: formatRut(e.target.value) })}
                    />
                    <Field
                      label={karinId && isAffected ? "Correo personal" : "Correo"}
                      type="email"
                      value={reporter.email}
                      error={fields["reporter.email"]}
                      onChange={(e) => setReporter({ ...reporter, email: e.target.value })}
                    />
                    <Field label="Teléfono" value={reporter.phone} maxLength={40} onChange={(e) => setReporter({ ...reporter, phone: e.target.value })} />
                  </>
                )}
                {karinId && !isAffected && (
                  <div className="space-y-4 border-t border-line-soft pt-4">
                    <p className="text-sm font-semibold text-gray-900">Persona afectada</p>
                    <Field label="Nombre" value={affected.name} maxLength={150} error={fields["affected.name"]} onChange={(e) => setAffected({ ...affected, name: e.target.value })} />
                    <Field
                      label="RUN"
                      value={affected.rut}
                      placeholder="12.345.678-5"
                      maxLength={12}
                      error={fields["affected.rut"]}
                      onChange={(e) => setAffected({ ...affected, rut: formatRut(e.target.value) })}
                    />
                    <Field label="Correo personal" type="email" value={affected.email} error={fields["affected.email"]} onChange={(e) => setAffected({ ...affected, email: e.target.value })} />
                    <Field
                      label="Representación"
                      value={representation}
                      maxLength={300}
                      placeholder="Ej.: poder simple"
                      error={fields.representation}
                      onChange={(e) => setRepresentation(e.target.value)}
                    />
                  </div>
                )}
                {karin && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-violet-50 px-3.5 py-3 text-sm text-violet-900 ring-1 ring-violet-600/15 ring-inset">
                    <input type="checkbox" checked={requestsDt} onChange={(e) => setRequestsDt(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-highlight)]" />
                    <span>
                      Pide que investigue la Dirección del Trabajo
                      <span className="mt-0.5 block text-xs text-violet-700">La empresa deberá derivarla dentro de 3 días hábiles.</span>
                    </span>
                  </label>
                )}
                <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-800">
                  <input type="checkbox" checked={issueKey} onChange={(e) => setIssueKey(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-highlight)]" />
                  <span>
                    Entregar clave de seguimiento
                    <span className="block text-xs text-gray-500">Para que siga su caso y converse con el equipo en el portal.</span>
                  </span>
                </label>
              </div>
            )}
          </Panel>
          <Button type="submit" variant="primary" loading={busy} disabled={!categories} className="h-11 w-full">
            Registrar denuncia
          </Button>
        </aside>
      </form>
    </>
  );
}
