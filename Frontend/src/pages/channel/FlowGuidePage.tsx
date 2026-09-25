import { useState } from "react";
import { Link } from "react-router";
import { Badge, Breadcrumbs, Icon, PageHeader, Panel } from "../../components/ui";
import { type CaseStatus, STATUS } from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { FRAMEWORKS, type LegalFramework } from "../../lib/roles";

type Who = "reporter" | "manager" | "investigator" | "resolver" | "dt" | "authority";

interface Step {
  title: string;
  who: Who;
  /** Qué se hace en el sistema (botón o menú). */
  how: string;
  detail?: string;
  deadline?: { text: string; legal: boolean };
  /** Estado en que queda la denuncia. */
  status?: CaseStatus;
  optional?: boolean;
}

const WHO: Record<Who, { label: string; styles: string }> = {
  reporter: { label: "Denunciante", styles: "bg-gray-100 text-gray-700" },
  manager: { label: "Gestor", styles: "bg-sky-50 text-sky-700" },
  investigator: { label: "Investigador", styles: "bg-violet-50 text-violet-700" },
  resolver: { label: "Comité", styles: "bg-amber-50 text-amber-800" },
  dt: { label: "Dirección del Trabajo", styles: "bg-emerald-50 text-emerald-700" },
  authority: { label: "Autoridad", styles: "bg-emerald-50 text-emerald-700" },
};

const RECEIVE: Step = {
  title: "Llega la denuncia",
  who: "reporter",
  how: "Portal de denuncias, o el gestor la registra en «Registrar denuncia» (verbal con acta, carta, correo, otra empresa o autoridad).",
  status: "received",
};
const START: Step = {
  title: "Iniciar la revisión",
  who: "manager",
  how: "«Bandeja de denuncias» → «Iniciar revisión» en la fila de la denuncia. El denunciante recibe el acuse de recibo por el buzón.",
  status: "in_review",
};

/** Pasos comunes de las leyes sin procedimiento legal propio de investigación. */
function standardFlow(extra: { review?: Step[]; investigation?: Step[] }): Step[] {
  return [
    { ...RECEIVE, detail: "Puede ser anónima." },
    { ...START, deadline: { text: "Acuse en 7 días (ISO 37002)", legal: false } },
    ...(extra.review ?? []),
    {
      title: "Asignar investigador",
      who: "manager",
      how: "Menú «Por asignar» → «Asignar».",
      detail: "Si no tiene fundamento, el gestor puede «Proponer desestimar» y el comité decide.",
      status: "investigating",
    },
    {
      title: "Investigar",
      who: "investigator",
      how: "En la ficha: «Registrar diligencia», «Medida de resguardo» y mensajes con el denunciante.",
    },
    ...(extra.investigation ?? []),
    { title: "Proponer la conclusión", who: "investigator", how: "En la ficha: «Proponer conclusión» con el informe.", status: "resolution" },
    {
      title: "Aprobar el cierre",
      who: "resolver",
      how: "Menú «Por resolver» → «Aprobar cierre» con la resolución y la respuesta al denunciante, o «Devolver con observaciones».",
      deadline: { text: "Respuesta en 3 meses (ISO 37002)", legal: false },
      status: "closed",
    },
  ];
}

const FLOWS: { key: string; framework: LegalFramework; title: string; intro: string; steps: Step[]; notes?: string[] }[] = [
  {
    key: "karin_internal",
    framework: "ley_karin",
    title: "Investiga la empresa",
    intro: "Ley 21.643 y DS 21/2024. Los plazos en días hábiles excluyen sábados, domingos y festivos.",
    steps: [
      { ...RECEIVE, detail: "No puede ser anónima: se identifica a la persona afectada (nombre, RUN y correo personal)." },
      {
        title: "Medidas de resguardo y derivación al organismo administrador",
        who: "manager",
        how: "En la ficha: «Medida de resguardo» y, en «Procedimiento legal», registrar la derivación a la mutual o ISL.",
        deadline: { text: "El mismo día", legal: true },
      },
      START,
      {
        title: "Definir quién investiga: la empresa",
        who: "manager",
        how: "«Por asignar» → «Asignar» (o en la ficha «Definir procedimiento»). Si el denunciante pidió a la DT, se debe derivar.",
        deadline: { text: "3 días hábiles", legal: true },
      },
      {
        title: "Avisar a la DT del inicio y de las medidas",
        who: "manager",
        how: "Trámite en el portal de la DT; luego registrar el N° de ticket en «Procedimiento legal».",
        deadline: { text: "3 días hábiles", legal: true },
      },
      {
        title: "Informar a la otra empresa",
        who: "manager",
        how: "Solo en subcontratación o servicios transitorios. Registrar en «Procedimiento legal».",
        deadline: { text: "3 días hábiles", legal: true },
        optional: true,
      },
      { title: "Asignar investigador", who: "manager", how: "«Por asignar» → «Asignar».", status: "investigating" },
      {
        title: "Investigar oyendo a ambas partes",
        who: "investigator",
        how: "En la ficha: «Registrar diligencia» (entrevistas, documentos), medidas y mensajes.",
      },
      { title: "Proponer la conclusión", who: "investigator", how: "«Proponer conclusión» con el informe.", status: "resolution" },
      {
        title: "Aprobar el informe final",
        who: "resolver",
        how: "«Por resolver» → «Aprobar cierre» (o devolver con observaciones). No se cierra todavía.",
        deadline: { text: "30 días hábiles desde la recepción", legal: true },
        status: "follow_up",
      },
      {
        title: "Enviar el informe a la DT",
        who: "manager",
        how: "«Depósito de investigación» en el portal de la DT; registrar el ticket en «Procedimiento legal».",
        deadline: { text: "2 días hábiles", legal: true },
      },
      {
        title: "Pronunciamiento de la DT",
        who: "dt",
        how: "Cuando llegue, registrar su respuesta. Si no se pronuncia en plazo, las conclusiones se consideran válidas.",
        deadline: { text: "30 días hábiles", legal: true },
      },
      {
        title: "Aplicar medidas y sanciones e informar a las partes",
        who: "manager",
        how: "Registrar en «Procedimiento legal» las medidas aplicadas y cómo se informó al denunciante y al denunciado.",
        deadline: { text: "15 días corridos", legal: true },
        status: "closed",
      },
    ],
    notes: ["Una denuncia de Ley Karin no se puede desestimar: siempre se investiga o se deriva a la DT."],
  },
  {
    key: "karin_dt",
    framework: "ley_karin",
    title: "Investiga la Dirección del Trabajo",
    intro: "Cuando la empresa deriva la denuncia (o el denunciante lo pide) y cuando la persona denunció directamente ante la DT.",
    steps: [
      { ...RECEIVE, detail: "Si la denunció ante la DT, el gestor la registra como «Notificada por la DT» y parte en seguimiento." },
      {
        title: "Medidas de resguardo y derivación al organismo administrador",
        who: "manager",
        how: "En la ficha: «Medida de resguardo» y registrar la derivación a la mutual o ISL.",
        deadline: { text: "El mismo día (o al ser notificada por la DT)", legal: true },
      },
      START,
      {
        title: "Definir quién investiga: la DT",
        who: "manager",
        how: "«Por asignar» → «Asignar» y elegir «La Dirección del Trabajo». No requiere investigador interno.",
        deadline: { text: "3 días hábiles", legal: true },
        status: "follow_up",
      },
      {
        title: "Derivar la denuncia y sus antecedentes a la DT",
        who: "manager",
        how: "«Derivación de denuncia» en el portal de la DT; registrar el ticket en «Procedimiento legal».",
        deadline: { text: "3 días hábiles", legal: true },
      },
      {
        title: "Investigación de la DT",
        who: "dt",
        how: "Cuando llegue el informe, registrarlo en «Procedimiento legal».",
        deadline: { text: "30 días hábiles", legal: true },
      },
      {
        title: "Aplicar medidas y sanciones e informar a las partes",
        who: "manager",
        how: "Registrar las medidas aplicadas en «Procedimiento legal».",
        deadline: { text: "15 días corridos desde el informe", legal: true },
        status: "closed",
      },
    ],
  },
  {
    key: "crimes",
    framework: "ley_20393",
    title: "Delitos económicos",
    intro: "Ley 20.393 modificada por la Ley 21.595. La ley exige el canal, pero no fija plazos de investigación.",
    steps: standardFlow({
      investigation: [
        {
          title: "Evaluar denuncia al Ministerio Público",
          who: "manager",
          how: "Si hay antecedentes de delito, registrarlo en «Procedimiento legal». La colaboración atenúa la responsabilidad de la empresa.",
          optional: true,
        },
      ],
    }),
  },
  {
    key: "data",
    framework: "ley_21719",
    title: "Datos personales",
    intro: "Ley 21.719, vigente desde el 1 de diciembre de 2026.",
    steps: standardFlow({
      review: [
        {
          title: "Evaluar si hubo una vulneración de seguridad",
          who: "manager",
          how: "Registrar el resultado en «Procedimiento legal».",
          deadline: { text: "Sin demora (referencia: 72 horas)", legal: false },
        },
        {
          title: "Reportar a la Agencia de Protección de Datos",
          who: "manager",
          how: "Solo si hubo vulneración. Registrar el N° de ingreso en «Procedimiento legal».",
          deadline: { text: "Sin dilaciones indebidas", legal: true },
          optional: true,
        },
        {
          title: "Comunicar a los titulares afectados",
          who: "manager",
          how: "Obligatorio si involucra datos sensibles, de niños, niñas y adolescentes o financieros.",
          optional: true,
        },
      ],
    }),
  },
  {
    key: "internal",
    framework: "internal",
    title: "Normativa interna",
    intro: "Faltas al código de ética, políticas o reglamento interno. Plazos de referencia de ISO 37002.",
    steps: standardFlow({}),
  },
];

const VARIANTS = [
  { title: "Notificada por un tribunal, la Agencia o el Ministerio Público", text: "Se registra con el plazo que fijó la autoridad y aparece el paso «Responder a…» con esa fecha." },
  { title: "Detectada internamente", text: "Por auditoría o controles: no hay denunciante, por lo que no hay acuse ni buzón de mensajes." },
  { title: "Remitida por otra empresa", text: "En subcontratación: los plazos corren desde que tu empresa la recibe." },
  { title: "Conflicto de interés", text: "Quien esté involucrado deja de ver el caso con cualquier rol; si era el investigador, el caso vuelve a asignación." },
];

/** Guía del flujo completo de una denuncia según su ley. */
export function FlowGuidePage() {
  const { basePath, user } = useChannel();
  const canSeeDeadlines = ["case_manager", "investigator", "auditor"].includes(user.activeRole);
  const [key, setKey] = useState(FLOWS[0]!.key);
  const flow = FLOWS.find((f) => f.key === key)!;
  const karin = flow.framework === "ley_karin";

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Flujo de denuncias" }]} />
      <PageHeader
        title="Flujo de denuncias"
        description="Qué pasa con una denuncia desde que llega hasta que se cierra, según su ley: quién actúa, qué botón usar, el plazo y en qué estado queda."
      />

      <div className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist">
        {[
          { k: "karin_internal", label: FRAMEWORKS.ley_karin.label, active: karin },
          { k: "crimes", label: "Delitos (Ley 20.393)", active: key === "crimes" },
          { k: "data", label: "Datos personales (Ley 21.719)", active: key === "data" },
          { k: "internal", label: FRAMEWORKS.internal.label, active: key === "internal" },
        ].map((t) => (
          <button
            key={t.k}
            role="tab"
            aria-selected={t.active}
            onClick={() => setKey(t.k)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition ${
              t.active ? "bg-accent text-white" : "bg-white text-gray-700 ring-1 ring-line hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title={karin ? `Ley Karin · ${flow.title}` : flow.title}
          description={flow.intro}
          toolbar={
            karin ? (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 sm:inline-grid">
                {FLOWS.filter((f) => f.framework === "ley_karin").map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setKey(f.key)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      key === f.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    {f.title}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        >
          <ol>
            {flow.steps.map((s, i) => (
              <li key={i} className="relative flex gap-4 pb-7 last:pb-0">
                {i < flow.steps.length - 1 && <span aria-hidden className="absolute top-9 bottom-0 left-4 w-px bg-line" />}
                <span
                  className={`relative flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    s.optional ? "bg-white text-gray-500 ring-1 ring-line" : "bg-accent text-white"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900">{s.title}</p>
                    {s.optional && <span className="text-xs text-gray-500">(si corresponde)</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${WHO[s.who].styles}`}>{WHO[s.who].label}</span>
                    {s.deadline && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          s.deadline.legal ? "bg-red-50 text-red-700 ring-red-600/15" : "bg-gray-50 text-gray-600 ring-gray-500/15"
                        }`}
                      >
                        <Icon name="clock" className="size-3" />
                        {s.deadline.text}
                        {!s.deadline.legal && " · referencial"}
                      </span>
                    )}
                    {s.status && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                        queda <Badge {...STATUS[s.status]} />
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.how}</p>
                  {s.detail && <p className="mt-1 text-sm text-gray-500">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
          {flow.notes?.map((n) => (
            <p key={n} className="mt-6 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-amber-600/15 ring-inset">
              {n}
            </p>
          ))}
        </Panel>

        <aside className="space-y-6 xl:sticky xl:top-24">
          <Panel title="Quién hace qué">
            <ul className="space-y-3 text-sm">
              {(["manager", "investigator", "resolver"] as Who[]).map((w) => (
                <li key={w} className="flex gap-3">
                  <span className={`h-fit shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${WHO[w].styles}`}>{WHO[w].label}</span>
                  <span className="text-gray-600">
                    {w === "manager"
                      ? "Recibe, inicia la revisión, define el procedimiento, asigna y registra los hitos legales."
                      : w === "investigator"
                        ? "Investiga las denuncias que tiene asignadas y propone la conclusión."
                        : "Aprueba el cierre o lo devuelve. En modalidad completa, no resuelve lo que investigó."}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Variantes">
            <ul className="space-y-4">
              {VARIANTS.map((v) => (
                <li key={v.title} className="text-sm">
                  <p className="font-medium text-gray-900">{v.title}</p>
                  <p className="mt-0.5 text-gray-600">{v.text}</p>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Plazos">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-red-700">Rojo</span>: plazo legal. <span className="font-medium text-gray-700">Gris</span>:
              referencia de buenas prácticas. Cada denuncia muestra sus fechas exactas en su ficha
              {canSeeDeadlines && (
                <>
                  {" "}y en{" "}
                  <Link to={`${basePath}/deadlines`} className="font-medium text-highlight-text hover:underline">
                    Plazos
                  </Link>
                </>
              )}
              .
            </p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
