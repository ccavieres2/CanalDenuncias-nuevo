import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { Alert, Button, Field, Icon, Select } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { usePortal } from "../../lib/portal";
import { AuthenticatorSetup } from "./AuthenticatorSetup";
import { formatRut, isValidRut } from "../../lib/rut";
import { FRAMEWORKS, FRAMEWORK_ORDER } from "../../lib/roles";

const INVOLVED_RELATIONS = [
  "Persona denunciada",
  "Testigo",
  "Otra persona involucrada",
] as const;
type Involved = { name: string; relation: (typeof INVOLVED_RELATIONS)[number] };

/** Ley Karin: quién realizó la conducta respecto de la persona afectada. */
const OFFENDER_OPTIONS = [
  { value: "superior", label: "Una jefatura o superior" },
  { value: "peer", label: "Un compañero o compañera" },
  { value: "subordinate", label: "Una persona a su cargo" },
  { value: "third_party", label: "Un cliente, proveedor o usuario" },
  { value: "other_company", label: "Alguien de otra empresa (contratista)" },
] as const;
type Offender = (typeof OFFENDER_OPTIONS)[number]["value"];

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Palabras cotidianas → términos que usan las categorías (sin tildes). */
const SYNONYMS: [string[], string[]][] = [
  [
    ["sueldo", "salario", "pago", "liquidacion", "plata", "turno", "feriado"],
    ["remuneraciones", "jornada", "vacaciones"],
  ],
  [
    ["robo", "robar", "hurto", "estafa", "desfalco"],
    ["apropiacion", "fraude", "uso de vehiculos"],
  ],
  [["coima", "soborno", "sobornar"], ["cohecho"]],
  [
    [
      "grito",
      "insulto",
      "humilla",
      "maltrato",
      "hostiga",
      "bullying",
      "mobbing",
      "jefe",
      "jefa",
    ],
    ["acoso", "hostigamiento", "maltrato"],
  ],
  [
    ["tocar", "toqueteo", "insinuacion", "sexual"],
    ["acoso sexual", "caracter sexual"],
  ],
  [
    ["cliente", "golpe", "agresion", "amenaza"],
    ["violencia", "agresion", "amenazas"],
  ],
  [
    ["accidente", "peligro", "epp", "lesion"],
    ["riesgos", "integridad"],
  ],
  [
    ["correo", "clave", "password", "hackeo", "virus"],
    ["contrasenas", "informatico", "seguridad de la informacion"],
  ],
  [["rut", "filtracion", "privacidad", "base de datos"], ["datos personales"]],
  [
    ["pariente", "familiar", "amigo", "proveedor"],
    ["conflicto de interes", "intereses personales"],
  ],
  [["contaminacion", "residuos", "derrame"], ["medio ambiente"]],
  [
    ["borracho", "ebrio", "drogado"],
    ["alcohol", "drogas"],
  ],
  [["racismo", "machismo", "homofobia", "edad"], ["discriminacion"]],
  [
    ["venganza", "castigo", "despido"],
    ["represalias", "castigos"],
  ],
];
const synonymsOf = (term: string) =>
  term.length < 3
    ? []
    : SYNONYMS.filter(([words]) =>
        words.some((w) => w.startsWith(term) || term.startsWith(w)),
      ).flatMap(([, to]) => to);

const STEPS = [
  {
    title: "¿De qué se trata?",
    help: "Elige la opción que mejor describa lo ocurrido. Si no estás seguro, elige «Otro».",
  },
  {
    title: "¿Qué pasó?",
    help: "Cuéntanos los hechos con el mayor detalle posible.",
  },
  {
    title: "¿Quiénes estuvieron involucrados?",
    help: "Opcional. Indica nombre o cargo de quienes participaron o presenciaron los hechos.",
  },
  {
    title: "¿Quieres identificarte?",
    help: "Tu identidad solo la conocerá el equipo designado para gestionar el canal.",
  },
  {
    title: "Revisa y envía",
    help: "Confirma que todo esté correcto antes de enviar.",
  },
] as const;

/** A qué paso pertenece cada campo que puede rechazar el servidor. */
function stepOfField(field: string): number {
  if (field === "categoryId" || field === "topicDetail") return 0;
  if (field === "offenderRelation" || field === "ongoing") return 1;
  if (
    ["subject", "description", "occurredWhen", "occurredWhere"].includes(field)
  )
    return 1;
  if (field.startsWith("involved")) return 2;
  if (
    ["reporter", "affected", "representation", "relation", "anonymous"].some(
      (f) => field.startsWith(f),
    )
  )
    return 3;
  return 4;
}

const textareaClass =
  "mt-2 block w-full rounded-lg border bg-white px-3.5 py-2.5 text-base text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:ring-4 sm:text-sm";

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <span
      data-field-error
      className="mt-1.5 flex items-center gap-1.5 text-sm text-red-600"
    >
      <Icon name="error" className="size-4 shrink-0" />
      {error}
    </span>
  );
}

/** Lleva la vista al primer campo con error (en celular podría quedar tapado por la barra de botones). */
function revealFirstError() {
  requestAnimationFrame(() =>
    document
      .querySelector('[aria-invalid="true"], [data-field-error]')
      ?.scrollIntoView({ block: "center", behavior: "smooth" }),
  );
}

/** Tarjeta seleccionable (radio) usada en las preguntas de opción única. */
function Choice({
  name,
  checked,
  onSelect,
  title,
  text,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  text?: string | null;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3.5 ring-1 ring-inset transition ${
        checked
          ? "bg-accent-soft ring-2 ring-highlight"
          : "bg-white ring-line hover:bg-gray-50"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-1 size-4 shrink-0 accent-[var(--color-highlight)]"
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-gray-900">
          {title}
        </span>
        {text && (
          <span className="mt-0.5 block text-sm leading-relaxed text-gray-500">
            {text}
          </span>
        )}
      </span>
    </label>
  );
}

/** Fila del resumen final con enlace para volver a editar ese paso. */
function SummaryRow({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
          {label}
        </p>
        <div className="mt-1 text-sm break-words text-gray-900">{children}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-sm font-semibold text-highlight-text hover:underline"
      >
        Editar
      </button>
    </div>
  );
}

/** Formulario público para hacer una denuncia, paso a paso. */
export function PortalReportPage() {
  const { apiBase, basePath, data } = usePortal();
  const [step, setStep] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [occurredWhen, setOccurredWhen] = useState("");
  const [occurredWhere, setOccurredWhere] = useState("");
  const [involved, setInvolved] = useState<Involved[]>([]);
  const [anonymous, setAnonymous] = useState<boolean | null>(
    data.portal.allowAnonymous ? null : false,
  );
  const [reporter, setReporter] = useState({
    name: "",
    email: "",
    phone: "",
    rut: "",
  });
  // Ley Karin: si denuncia un tercero, se identifica a la persona afectada y la representación (Ord. DT 497/21).
  const [isAffected, setIsAffected] = useState(true);
  const [affected, setAffected] = useState({ name: "", rut: "", email: "" });
  const [representation, setRepresentation] = useState("");
  const [relation, setRelation] = useState("");
  // Ley Karin: quién quiere que investigue (la ley le da derecho a pedir que sea la Dirección del Trabajo).
  const [investigator, setInvestigator] = useState<"company" | "dt">("company");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [topicDetail, setTopicDetail] = useState("");
  const [offender, setOffender] = useState<Offender | "">("");
  const [ongoing, setOngoing] = useState<"yes" | "no" | "unknown" | "">("");
  const [urgent, setUrgent] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    code: string;
    trackingKey: string;
    session: string;
  } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const category = data.categories.find((c) => c.id === categoryId);
  const karin = category?.framework === "ley_karin";
  // Ley Karin no admite denuncias anónimas: siempre se identifica.
  const identified = karin || anonymous === false;
  const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  // Búsqueda sin tildes ni mayúsculas, en el nombre y la descripción de cada categoría; cada palabra debe
  // aparecer (o alguno de sus sinónimos).
  const terms = fold(categoryQuery).split(/\s+/).filter(Boolean);
  const matches = (text: string) =>
    terms.every((t) => [t, ...synonymsOf(t)].some((w) => text.includes(w)));
  const groups = FRAMEWORK_ORDER.map((fw) => ({
    fw,
    items: data.categories.filter(
      (c) =>
        c.framework === fw &&
        (!terms.length ||
          matches(fold(`${c.name} ${c.description ?? ""}`)) ||
          c.id === categoryId),
    ),
  })).filter((g) => g.items.length);
  const dirty = Boolean(categoryId || subject || description);
  const last = STEPS.length - 1;

  // Evita perder lo escrito al cerrar o recargar la pestaña por error.
  useEffect(() => {
    if (!dirty || result) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, result]);

  /** Al corregir un campo, su error desaparece. */
  function clearError(key: string) {
    if (!fields[key]) return;
    setFields((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function goTo(next: number) {
    setStep(next);
    setError(null);
    window.scrollTo({ top: 0 });
    // Lleva el foco a la pregunta para lectores de pantalla y teclado.
    setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
  }

  /** Valida el paso actual en el navegador (el servidor vuelve a validar todo). */
  function validate(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0 && !categoryId)
      e.categoryId = "Elige una opción para continuar";
    if (s === 0 && category?.asksDetail && topicDetail.trim().length < 5)
      e.topicDetail = "Cuéntanos brevemente de qué se trata";
    if (s === 1 && karin && !offender)
      e.offenderRelation = "Indica quién realizó la conducta";
    if (s === 1) {
      if (subject.trim().length < 5)
        e.subject = "Escribe un título de al menos 5 caracteres";
      if (description.trim().length < 30)
        e.description = "Cuéntanos un poco más: al menos 30 caracteres";
    }
    if (s === 2) {
      involved.forEach((p, i) => {
        if (p.name.trim() && p.name.trim().length < 2)
          e[`involved.${i}.name`] = "Escribe al menos 2 caracteres";
      });
    }
    if (s === 3) {
      if (!karin && anonymous === null)
        e.anonymous = "Elige una opción para continuar";
      if (identified) {
        if (reporter.name.trim().length < 2)
          e["reporter.name"] = "Escribe tu nombre";
        if (reporter.email && !emailOk(reporter.email))
          e["reporter.email"] = "Correo inválido";
        if (reporter.rut && !isValidRut(reporter.rut))
          e["reporter.rut"] = "RUN inválido";
      }
      if (karin && isAffected) {
        if (!reporter.rut)
          e["reporter.rut"] = "El RUN es obligatorio en denuncias de Ley Karin";
        if (!reporter.email)
          e["reporter.email"] =
            "El correo personal es obligatorio en denuncias de Ley Karin";
      }
      if (karin && !isAffected) {
        if (affected.name.trim().length < 2)
          e["affected.name"] = "Indica el nombre de la persona afectada";
        if (!isValidRut(affected.rut))
          e["affected.rut"] = affected.rut
            ? "RUN inválido"
            : "Indica el RUN de la persona afectada";
        if (!emailOk(affected.email))
          e["affected.email"] =
            "Indica el correo personal de la persona afectada";
        if (!representation.trim())
          e.representation =
            "Indica cómo la representas (por ejemplo, poder simple)";
      }
    }
    if (s === 4 && !privacy)
      e.privacyAccepted = "Debes aceptar el aviso de privacidad";
    return e;
  }

  function next() {
    const e = validate(step);
    setFields(e);
    if (Object.keys(e).length === 0) goTo(step + 1);
    else revealFirstError();
  }

  function back() {
    setFields({});
    if (step > 0) goTo(step - 1);
  }

  async function send() {
    const e = validate(last);
    setFields(e);
    if (Object.keys(e).length) {
      revealFirstError();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        code: string;
        trackingKey: string;
        session: string;
      }>(`${apiBase}/reports`, {
        method: "POST",
        body: {
          categoryId,
          subject,
          description,
          occurredWhen,
          occurredWhere,
          involved: involved.filter((p) => p.name.trim()),
          relation: relation || undefined,
          requestsDt: karin && investigator === "dt",
          topicDetail: category?.asksDetail ? topicDetail : undefined,
          offenderRelation: karin && offender ? offender : undefined,
          ongoing: karin && ongoing ? ongoing : undefined,
          urgentProtection: karin && urgent,
          anonymous: !identified,
          reporter: identified ? reporter : undefined,
          reporterIsAffected: !karin || isAffected,
          affected: karin && !isAffected ? affected : undefined,
          representation: karin && !isAffected ? representation : undefined,
          privacyAccepted: privacy,
        },
      });
      setResult(res);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        // Vuelve al primer paso con errores.
        setFields(err.fields);
        const target = Math.min(...Object.keys(err.fields).map(stepOfField));
        if (target !== step) goTo(target);
        setError("Revisa los datos marcados.");
        revealFirstError();
      } else
        setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (step === last) void send();
    else next();
  }

  if (result)
    return (
      <ReportSent
        {...result}
        company={data.company}
        basePath={basePath}
        apiBase={apiBase}
      />
    );

  const years = data.retentionMonths / 12;
  const namedInvolved = involved.filter((p) => p.name.trim());

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-2xl">
      {/* Progreso */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center justify-between gap-4">
          <Link
            to={basePath}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
          >
            <Icon name="close" className="size-3.5" />
            Salir
          </Link>
          <p className="text-sm font-medium text-gray-500">
            Paso {step + 1} de {STEPS.length}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-colors ${i <= step ? "bg-highlight" : "bg-gray-200"}`}
            />
          ))}
        </div>
      </div>

      {/* Pregunta */}
      <div className="rounded-2xl border border-line bg-white px-5 py-6 shadow-card sm:px-8 sm:py-8">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-gray-900 outline-none sm:text-[28px]"
        >
          {step === 3 && karin ? "Tus datos" : STEPS[step].title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-500">
          {step === 3 && karin
            ? "Necesarios para tramitar una denuncia de Ley Karin."
            : STEPS[step].help}
        </p>

        <div className="mt-6 space-y-6 sm:mt-8">
          {error && <Alert>{error}</Alert>}

          {step === 0 && (
            <>
              <label className="relative block">
                <span className="sr-only">Buscar</span>
                <Icon
                  name="search"
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-gray-400"
                />
                <input
                  value={categoryQuery}
                  onChange={(e) => setCategoryQuery(e.target.value)}
                  placeholder="Buscar: acoso, robo, sueldo, datos…"
                  className="block h-11 w-full rounded-lg border border-gray-300 bg-white pr-3.5 pl-10 text-base text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-highlight focus:ring-4 focus:ring-highlight/20 sm:text-sm"
                />
              </label>
              {groups.length === 0 && (
                <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                  No encontramos una categoría con esas palabras. Elige «Otro» y
                  cuéntanos de qué se trata.
                </p>
              )}
              {groups.map((g) => (
                <fieldset key={g.fw}>
                  <legend className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    {FRAMEWORKS[g.fw].label}
                    {g.fw === "ley_karin" && (
                      <span className="font-normal normal-case">
                        {" "}
                        · requiere identificar a la persona afectada
                      </span>
                    )}
                  </legend>
                  <div className="grid gap-2">
                    {g.items.map((c) => (
                      <Choice
                        key={c.id}
                        name="category"
                        checked={categoryId === c.id}
                        onSelect={() => {
                          setCategoryId(c.id);
                          setFields({});
                        }}
                        title={c.name}
                        text={categoryId === c.id ? c.description : null}
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
              <FieldError error={fields.categoryId} />
              {category?.asksDetail && (
                <Field
                  label="Cuéntanos en pocas palabras de qué se trata"
                  value={topicDetail}
                  onChange={(e) => {
                    setTopicDetail(e.target.value);
                    clearError("topicDetail");
                  }}
                  maxLength={300}
                  placeholder="Ej.: uso de vehículos fuera de horario"
                  error={fields.topicDetail}
                  hint="Nos ayuda a derivarla a la persona correcta."
                />
              )}
            </>
          )}

          {step === 1 && (
            <>
              <Field
                label="Título breve"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  clearError("subject");
                }}
                maxLength={150}
                placeholder="Ej.: Cobro de comisiones a proveedores"
                error={fields.subject}
              />
              <label className="block">
                <span className="block text-sm font-medium text-gray-800">
                  Relato de los hechos
                </span>
                <span className="mt-0.5 block text-sm text-gray-500">
                  Qué ocurrió, quiénes participaron y cómo te enteraste.
                </span>
                <textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    clearError("description");
                  }}
                  rows={7}
                  maxLength={10000}
                  className={`${textareaClass} ${
                    fields.description
                      ? "border-red-400 focus:ring-red-100"
                      : "border-gray-300 focus:border-highlight focus:ring-highlight/20"
                  }`}
                />
                <span className="mt-1 flex justify-between gap-3 text-xs text-gray-400">
                  <span>
                    {description.trim().length < 30
                      ? `Mínimo 30 caracteres`
                      : ""}
                  </span>
                  <span>{description.length} / 10.000</span>
                </span>
                <FieldError error={fields.description} />
              </label>
              {karin && (
                <div className="space-y-5 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200/70 ring-inset sm:p-5">
                  <fieldset>
                    <legend className="text-sm font-semibold text-gray-900">
                      ¿Quién realizó la conducta?
                    </legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {OFFENDER_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => {
                            setOffender(o.value);
                            clearError("offenderRelation");
                          }}
                          className={`rounded-lg px-3 py-2.5 text-left text-sm font-medium ring-1 ring-inset transition ${
                            offender === o.value
                              ? "bg-accent-soft text-gray-900 ring-2 ring-highlight"
                              : "bg-white text-gray-700 ring-line hover:bg-gray-50"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <FieldError error={fields.offenderRelation} />
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-semibold text-gray-900">
                      ¿La situación sigue ocurriendo?
                    </legend>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["yes", "Sí"],
                          ["no", "No"],
                          ["unknown", "No lo sé"],
                        ] as const
                      ).map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setOngoing(v)}
                          className={`rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ring-inset transition ${
                            ongoing === v
                              ? "bg-accent-soft text-gray-900 ring-2 ring-highlight"
                              : "bg-white text-gray-700 ring-line hover:bg-gray-50"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-white px-3.5 py-3 ring-1 ring-line ring-inset">
                    <input
                      type="checkbox"
                      checked={urgent}
                      onChange={(e) => setUrgent(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--color-highlight)]"
                    />
                    <span className="text-sm">
                      <span className="block font-medium text-gray-900">
                        Necesito medidas de protección urgentes
                      </span>
                      <span className="block text-gray-500">
                        Por ejemplo, dejar de trabajar junto a la persona
                        denunciada. La empresa debe adoptarlas de inmediato.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {karin && (
                <fieldset className="rounded-xl bg-violet-50/60 p-4 ring-1 ring-violet-600/15 ring-inset sm:p-5">
                  <legend className="sr-only">Quién investiga</legend>
                  <p className="text-sm font-semibold text-gray-900">
                    ¿Quién quieres que investigue?
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">
                    Por la Ley Karin puedes pedir que investigue la Dirección
                    del Trabajo. La empresa igual debe protegerte con medidas de
                    resguardo desde ya.
                  </p>
                  <div className="mt-3 grid gap-2">
                    <Choice
                      name="investigator"
                      checked={investigator === "company"}
                      onSelect={() => setInvestigator("company")}
                      title="La empresa"
                      text="Investigación interna en máximo 30 días hábiles. Su informe lo revisa la Dirección del Trabajo."
                    />
                    <Choice
                      name="investigator"
                      checked={investigator === "dt"}
                      onSelect={() => setInvestigator("dt")}
                      title="La Dirección del Trabajo"
                      text="La empresa deriva tu denuncia a la DT dentro de 3 días hábiles."
                    />
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    También puedes denunciar directamente ante la DT en{" "}
                    <a
                      href="https://www.dt.gob.cl"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-highlight-text underline"
                    >
                      dt.gob.cl
                    </a>
                    .
                  </p>
                </fieldset>
              )}
              <div className="grid gap-6 sm:grid-cols-2">
                <Field
                  label="¿Cuándo ocurrió? (opcional)"
                  value={occurredWhen}
                  onChange={(e) => setOccurredWhen(e.target.value)}
                  maxLength={200}
                  placeholder="Fecha o periodo aproximado"
                />
                <Field
                  label="¿Dónde ocurrió? (opcional)"
                  value={occurredWhere}
                  onChange={(e) => setOccurredWhere(e.target.value)}
                  maxLength={200}
                  placeholder="Lugar, sucursal o área"
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {involved.length === 0 && (
                <p className="rounded-xl bg-gray-50 px-4 py-4 text-sm text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                  Si no sabes quiénes participaron o prefieres no indicarlo,
                  puedes continuar.
                </p>
              )}
              {involved.map((p, i) => (
                <div
                  key={i}
                  className="space-y-4 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200/70 ring-inset"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900">
                      Persona {i + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setInvolved((list) => list.filter((_, j) => j !== i))
                      }
                      className="text-sm font-medium text-gray-500 hover:text-red-600"
                    >
                      Quitar
                    </button>
                  </div>
                  <Field
                    label="Nombre o cargo"
                    value={p.name}
                    onChange={(e) => {
                      setInvolved((list) =>
                        list.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      );
                      clearError(`involved.${i}.name`);
                    }}
                    maxLength={150}
                    error={fields[`involved.${i}.name`]}
                  />
                  <div>
                    <span className="block text-sm font-medium text-gray-800">
                      Relación con los hechos
                    </span>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {INVOLVED_RELATIONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() =>
                            setInvolved((list) =>
                              list.map((x, j) =>
                                j === i ? { ...x, relation: r } : x,
                              ),
                            )
                          }
                          className={`rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ring-inset transition ${
                            p.relation === r
                              ? "bg-accent-soft text-gray-900 ring-2 ring-highlight"
                              : "bg-white text-gray-700 ring-line hover:bg-gray-50"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              {involved.length < 20 && (
                <Button
                  type="button"
                  onClick={() =>
                    setInvolved((list) => [
                      ...list,
                      { name: "", relation: "Persona denunciada" },
                    ])
                  }
                  className="w-full sm:w-auto"
                >
                  <Icon name="plus" />
                  Agregar persona
                </Button>
              )}
            </>
          )}

          {step === 3 && (
            <>
              {karin ? (
                <>
                  <p className="rounded-xl bg-violet-50/60 px-4 py-3.5 text-sm text-gray-700 ring-1 ring-violet-600/15 ring-inset">
                    Las denuncias de Ley Karin deben identificar a la persona
                    afectada: así lo exige la Dirección del Trabajo. Tu
                    identidad solo la conoce el equipo designado y se mantiene
                    en estricta reserva.
                  </p>
                  <div className="grid gap-2">
                    <Choice
                      name="affected"
                      checked={isAffected}
                      onSelect={() => {
                        setIsAffected(true);
                        setFields({});
                      }}
                      title="Soy la persona afectada"
                    />
                    <Choice
                      name="affected"
                      checked={!isAffected}
                      onSelect={() => {
                        setIsAffected(false);
                        setFields({});
                      }}
                      title="Denuncio en representación de otra persona"
                      text="Por ejemplo, con un poder simple de la persona afectada."
                    />
                  </div>
                </>
              ) : (
                data.portal.allowAnonymous && (
                  <div className="grid gap-2">
                    <Choice
                      name="anonymous"
                      checked={anonymous === true}
                      onSelect={() => {
                        setAnonymous(true);
                        setFields({});
                      }}
                      title="No, prefiero ser anónimo"
                      text="No pedimos tu nombre. Igual podrás conversar con el equipo usando tu clave de seguimiento."
                    />
                    <Choice
                      name="anonymous"
                      checked={anonymous === false}
                      onSelect={() => {
                        setAnonymous(false);
                        setFields({});
                      }}
                      title="Sí, quiero identificarme"
                      text="Facilita la investigación. Tu identidad solo la conoce el equipo del canal."
                    />
                    <FieldError error={fields.anonymous} />
                    {anonymous === true && (
                      <p className="mt-1 rounded-xl bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                        No registramos tu IP, tu dispositivo ni cookies. Para
                        mayor reserva, envía la denuncia desde un dispositivo y
                        una red personales (no el computador ni el Wi-Fi de la
                        empresa) y evita en el relato datos que solo tú conoces.
                      </p>
                    )}
                  </div>
                )
              )}
              {identified && (
                <div className="space-y-5 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200/70 ring-inset sm:p-5">
                  {karin && !isAffected && (
                    <p className="text-sm font-semibold text-gray-900">
                      Tus datos
                    </p>
                  )}
                  <Field
                    label="Nombre completo"
                    value={reporter.name}
                    onChange={(e) => {
                      setReporter({ ...reporter, name: e.target.value });
                      clearError("reporter.name");
                    }}
                    maxLength={150}
                    error={fields["reporter.name"]}
                    autoComplete="name"
                  />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field
                      label={karin && isAffected ? "RUN" : "RUN (opcional)"}
                      value={reporter.rut}
                      onChange={(e) => {
                        setReporter({
                          ...reporter,
                          rut: formatRut(e.target.value),
                        });
                        clearError("reporter.rut");
                      }}
                      maxLength={12}
                      inputMode="text"
                      placeholder="12.345.678-5"
                      error={fields["reporter.rut"]}
                    />
                    <Field
                      label={
                        karin && isAffected
                          ? "Correo personal"
                          : "Correo (opcional)"
                      }
                      type="email"
                      value={reporter.email}
                      onChange={(e) => {
                        setReporter({ ...reporter, email: e.target.value });
                        clearError("reporter.email");
                      }}
                      error={fields["reporter.email"]}
                      autoComplete="email"
                    />
                  </div>
                  <Field
                    label="Teléfono (opcional)"
                    type="tel"
                    value={reporter.phone}
                    onChange={(e) =>
                      setReporter({ ...reporter, phone: e.target.value })
                    }
                    maxLength={40}
                    autoComplete="tel"
                  />
                </div>
              )}
              {karin && !isAffected && (
                <div className="space-y-5 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200/70 ring-inset sm:p-5">
                  <p className="text-sm font-semibold text-gray-900">
                    Persona afectada
                  </p>
                  <Field
                    label="Nombre completo"
                    value={affected.name}
                    onChange={(e) => {
                      setAffected({ ...affected, name: e.target.value });
                      clearError("affected.name");
                    }}
                    maxLength={150}
                    error={fields["affected.name"]}
                  />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field
                      label="RUN"
                      value={affected.rut}
                      onChange={(e) => {
                        setAffected({
                          ...affected,
                          rut: formatRut(e.target.value),
                        });
                        clearError("affected.rut");
                      }}
                      maxLength={12}
                      placeholder="12.345.678-5"
                      error={fields["affected.rut"]}
                    />
                    <Field
                      label="Correo personal"
                      type="email"
                      value={affected.email}
                      onChange={(e) => {
                        setAffected({ ...affected, email: e.target.value });
                        clearError("affected.email");
                      }}
                      error={fields["affected.email"]}
                    />
                  </div>
                  <Field
                    label="¿Cómo la representas?"
                    value={representation}
                    onChange={(e) => {
                      setRepresentation(e.target.value);
                      clearError("representation");
                    }}
                    maxLength={300}
                    placeholder="Ej.: poder simple firmado por la persona afectada"
                    error={fields.representation}
                    hint="El equipo te pedirá el poder por el buzón seguro."
                  />
                </div>
              )}
              {(identified || anonymous !== null) && (
                <label className="block">
                  <span className="block text-sm font-medium text-gray-800">
                    Tu relación con la empresa (opcional)
                  </span>
                  <div className="mt-2">
                    <Select value={relation} onChange={setRelation}>
                      <option value="">Prefiero no decirlo</option>
                      {data.relations.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </Select>
                  </div>
                </label>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <div className="divide-y divide-line-soft rounded-xl px-4 ring-1 ring-line ring-inset">
                <SummaryRow label="De qué se trata" onEdit={() => goTo(0)}>
                  {category?.name}
                  {category?.asksDetail && topicDetail && (
                    <span className="block text-gray-600">{topicDetail}</span>
                  )}
                </SummaryRow>
                <SummaryRow label="Qué pasó" onEdit={() => goTo(1)}>
                  <span className="block font-medium">{subject}</span>
                  <span className="mt-1 line-clamp-3 block whitespace-pre-line text-gray-600">
                    {description}
                  </span>
                  {(occurredWhen || occurredWhere) && (
                    <span className="mt-1 block text-gray-500">
                      {[occurredWhen, occurredWhere]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {karin && (
                    <span className="mt-1 block text-gray-500">
                      {
                        OFFENDER_OPTIONS.find((o) => o.value === offender)
                          ?.label
                      }
                      {urgent && " · pide protección urgente"} · Investiga:{" "}
                      {investigator === "dt"
                        ? "la Dirección del Trabajo"
                        : "la empresa"}
                    </span>
                  )}
                </SummaryRow>
                <SummaryRow
                  label="Personas involucradas"
                  onEdit={() => goTo(2)}
                >
                  {namedInvolved.length
                    ? namedInvolved
                        .map((p) => `${p.name} (${p.relation.toLowerCase()})`)
                        .join(", ")
                    : "No indicadas"}
                </SummaryRow>
                <SummaryRow label="Tus datos" onEdit={() => goTo(3)}>
                  {identified
                    ? [
                        reporter.name,
                        reporter.rut,
                        reporter.email,
                        reporter.phone,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Denuncia anónima"}
                  {karin && !isAffected && (
                    <span className="block text-gray-500">
                      En representación de {affected.name} ({affected.rut}) ·{" "}
                      {representation}
                    </span>
                  )}
                  {relation && (
                    <span className="block text-gray-500">{relation}</span>
                  )}
                </SummaryRow>
              </div>

              <details className="group rounded-xl bg-gray-50 ring-1 ring-gray-200/70 ring-inset">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold text-gray-900">
                  <span className="flex items-center gap-2">
                    <Icon name="lock" className="size-4 text-highlight-text" />
                    Aviso de privacidad (Ley 21.719)
                  </span>
                  <Icon
                    name="chevron"
                    className="size-3.5 rotate-90 text-gray-400 transition group-open:-rotate-90"
                  />
                </summary>
                <div className="space-y-2.5 border-t border-gray-200/70 px-4 py-4 text-sm leading-relaxed text-gray-600">
                  <p>
                    <strong className="text-gray-800">Responsable:</strong>{" "}
                    {data.company}.
                  </p>
                  <p>
                    <strong className="text-gray-800">Finalidad:</strong>{" "}
                    recibir, investigar y resolver tu denuncia, y cumplir las
                    obligaciones legales de la empresa (entre otras, la Ley
                    21.643 «Ley Karin» y la Ley 20.393). En denuncias de Ley
                    Karin, los antecedentes se informan a la Dirección del
                    Trabajo como exige la ley.
                  </p>
                  <p>
                    <strong className="text-gray-800">Quién accede:</strong>{" "}
                    solo las personas designadas para gestionar el canal. La
                    información puede entregarse a autoridades cuando la ley lo
                    exija (Dirección del Trabajo, Ministerio Público o
                    tribunales).
                  </p>
                  <p>
                    <strong className="text-gray-800">Conservación:</strong>{" "}
                    {years} {years === 1 ? "año" : "años"} desde el cierre del
                    caso; luego se elimina.
                  </p>
                  <p>
                    <strong className="text-gray-800">Tus derechos:</strong>{" "}
                    acceso, rectificación, supresión, oposición, portabilidad y
                    bloqueo, que puedes ejercer escribiendo por el buzón de tu
                    denuncia
                    {data.portal.contactEmail
                      ? ` o a ${data.portal.contactEmail}`
                      : ""}
                    .
                  </p>
                  <p>
                    No registramos tu dirección IP ni datos de tu dispositivo.
                  </p>
                </div>
              </details>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3.5 ring-1 ring-inset ${
                  fields.privacyAccepted ? "ring-red-300" : "ring-line"
                }`}
              >
                <input
                  type="checkbox"
                  checked={privacy}
                  onChange={(e) => {
                    setPrivacy(e.target.checked);
                    setFields({});
                  }}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--color-highlight)]"
                />
                <span className="text-[15px] text-gray-800">
                  Leí el aviso de privacidad y declaro que mi denuncia es de
                  buena fe.
                </span>
              </label>
              <FieldError error={fields.privacyAccepted} />
            </>
          )}
        </div>
      </div>

      {/* Navegación: fija abajo en el celular */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="flex items-center gap-3">
          {step > 0 && (
            <Button
              type="button"
              onClick={back}
              className="h-12 flex-1 sm:flex-none sm:px-6"
            >
              <Icon name="arrowLeft" />
              Atrás
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            className="h-12 flex-[2] text-base sm:ml-auto sm:flex-none sm:px-8"
          >
            {step === last
              ? "Enviar denuncia"
              : step === 2 && involved.length === 0
                ? "Continuar sin indicar"
                : "Siguiente"}
            {step !== last && <Icon name="chevron" className="size-3.5" />}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Confirmación con la clave de seguimiento (se muestra una sola vez). */
function ReportSent({
  code,
  trackingKey,
  session,
  company,
  basePath,
  apiBase,
}: {
  code: string;
  trackingKey: string;
  session: string;
  company: string;
  basePath: string;
  apiBase: string;
}) {
  const { data } = usePortal();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(trackingKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el navegador no permite copiar: queda la opción de descargar */
    }
  }

  function download() {
    const text = `Canal de denuncias de ${company}\nDenuncia: ${code}\nClave de seguimiento: ${trackingKey}\n\nIngresa en ${window.location.origin}${basePath}/seguimiento\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `denuncia-${code}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-line bg-white px-5 py-8 text-center shadow-card sm:px-10 sm:py-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Icon name="success" className="size-7" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-gray-900">
          Denuncia enviada
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Tu denuncia{" "}
          <span className="font-mono font-medium text-gray-900">{code}</span>{" "}
          fue recibida por el canal de {company}.
        </p>

        <div className="mt-8 rounded-xl bg-accent-soft px-4 py-5 ring-1 ring-highlight/20 ring-inset">
          <p className="text-xs font-semibold tracking-wide text-highlight-text uppercase">
            Tu clave de seguimiento
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tracking-wider break-all text-gray-900 sm:text-2xl">
            {trackingKey}
          </p>
          <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
            <Button type="button" onClick={copy}>
              <Icon name={copied ? "check" : "copy"} />
              {copied ? "Copiada" : "Copiar clave"}
            </Button>
            <Button type="button" onClick={download}>
              <Icon name="download" />
              Descargar
            </Button>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 ring-1 ring-amber-600/15 ring-inset">
          <Icon name="error" className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Guárdala en un lugar seguro.</strong> Es la única forma de
            ver el avance y responder los mensajes del equipo. Por tu privacidad
            no la guardamos en texto legible y no podemos recuperarla.
          </span>
        </div>

        {data.features.authenticator && (
          <div className="mt-6">
            <AuthenticatorSetup
              apiBase={apiBase}
              session={session}
              caseCode={code}
            />
          </div>
        )}

        <Link
          to={`${basePath}/seguimiento`}
          className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-highlight-text hover:underline"
        >
          Ir al seguimiento de mi denuncia
          <Icon name="chevron" className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
