import { useEffect, useState } from "react";
import { Alert, Breadcrumbs, Icon, PageHeader, Panel } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";

interface Resources {
  policy: string;
  contactEmail: string | null;
  mode: "simplified" | "complete";
  retentionMonths: number;
  hasConflictPlan: boolean;
}

/** Guías de procedimiento por marco legal (lo mismo que calcula el sistema en cada denuncia). */
const GUIDES: { key: string; title: string; subtitle: string; steps: { when: string; what: string }[]; note?: string }[] = [
  {
    key: "intake",
    title: "Vías de ingreso de una denuncia",
    subtitle: "Todas se registran en el canal el mismo día, para que los plazos corran y no se pierda ninguna",
    steps: [
      { when: "Portal", what: "Formulario web del canal. Permite anonimato, salvo en Ley Karin." },
      { when: "Directa", what: "En persona (se levanta acta firmada y se entrega copia), carta, correo, teléfono o a través de jefatura, sindicato o comité paritario." },
      { when: "Otra empresa", what: "Remitida por la empresa principal, contratista o usuaria (subcontratación o servicios transitorios)." },
      { when: "DT", what: "Denuncia Ley Karin presentada ante la Dirección del Trabajo: medidas de resguardo inmediatas al ser notificada." },
      { when: "Autoridades", what: "Tribunal (tutela laboral), Agencia de Protección de Datos, Ministerio Público u otra: se registra con el plazo que fije." },
      { when: "Interna", what: "Hallazgos de auditoría, del Encargado de Prevención de Delitos o de controles internos." },
    ],
    note: "La mutual o el ISL no reciben denuncias: solo entregan atención psicológica a la persona afectada.",
  },
  {
    key: "karin_internal",
    title: "Ley Karin · investigación interna",
    subtitle: "Ley 21.643 (arts. 211-A y ss. del Código del Trabajo) y DS 21/2024",
    steps: [
      { when: "Al recibir", what: "Medidas de resguardo y derivación al organismo administrador de la Ley 16.744 (atención psicológica temprana)." },
      { when: "3 días hábiles", what: "Decidir si investiga la empresa o la DT. Si investiga la empresa, avisar a la DT del inicio y de las medidas adoptadas." },
      { when: "30 días hábiles", what: "Concluir la investigación (desde la recepción de la denuncia), oyendo a ambas partes y por escrito." },
      { when: "2 días hábiles", what: "Enviar el informe final y sus conclusiones a la DT (depósito de la investigación)." },
      { when: "30 días hábiles", what: "Plazo de la DT para pronunciarse. Si no lo hace, las conclusiones se consideran válidas." },
      { when: "15 días corridos", what: "Aplicar medidas y sanciones desde el pronunciamiento (o desde que venció su plazo) e informar a denunciante y denunciado." },
    ],
    note: "No se admiten denuncias anónimas: la persona afectada se identifica con nombre, RUN y correo personal, o la representa un tercero (Ord. DT N° 497/21). Si el denunciante pide que investigue la DT, la empresa debe derivarla. Una denuncia Ley Karin no se puede desestimar.",
  },
  {
    key: "karin_dt",
    title: "Ley Karin · investiga la Dirección del Trabajo",
    subtitle: "Derivada por la empresa o presentada directamente ante la DT",
    steps: [
      { when: "Al recibir", what: "Medidas de resguardo. Si la denuncia se hizo ante la DT, esta notifica a la empresa y le pide adoptarlas de inmediato." },
      { when: "3 días hábiles", what: "Si la recibió la empresa, derivarla a la DT con todos sus antecedentes." },
      { when: "30 días hábiles", what: "Plazo de investigación de la DT, contado desde que recibe la derivación." },
      { when: "15 días corridos", what: "Aplicar las medidas y sanciones desde que se recibe el informe de la DT." },
    ],
  },
  {
    key: "karin_multi",
    title: "Ley Karin · más de una empresa",
    subtitle: "Régimen de subcontratación, servicios transitorios y terceros",
    steps: [
      { when: "3 días hábiles", what: "Si denuncia un trabajador de una contratista ante su empleador, este informa a la empresa principal o usuaria." },
      { when: "3 días hábiles", what: "Si la empresa principal recibe la denuncia, la remite a quien sustanciará el procedimiento (el empleador del denunciante o la DT)." },
      { when: "Terceros", what: "Si el agresor es un cliente, proveedor o usuario, igual se investiga y se adoptan medidas para proteger al trabajador." },
    ],
  },
  {
    key: "crimes",
    title: "Delitos económicos",
    subtitle: "Ley 20.393, modificada por la Ley 21.595",
    steps: [
      { when: "7 días", what: "Acuse de recibo al denunciante (buena práctica ISO 37002)." },
      { when: "Durante", what: "Investigación a cargo del Encargado de Prevención de Delitos o quien designe el modelo de prevención." },
      { when: "Si hay delito", what: "Evaluar la denuncia al Ministerio Público: la colaboración y la autodenuncia atenúan la responsabilidad de la empresa." },
      { when: "3 meses", what: "Respuesta al denunciante sobre lo realizado (buena práctica ISO 37002)." },
    ],
    note: "La ley exige un canal de denuncias como parte del modelo de prevención, pero no fija plazos de investigación.",
  },
  {
    key: "data",
    title: "Protección de datos personales",
    subtitle: "Ley 21.719, vigente desde el 1 de diciembre de 2026",
    steps: [
      { when: "Sin demora", what: "Evaluar si hubo una vulneración de seguridad: filtración, pérdida, alteración o acceso no autorizado." },
      { when: "Sin dilaciones indebidas", what: "Reportar la vulneración a la Agencia de Protección de Datos Personales (art. 14 sexies). Referencia: 72 horas." },
      { when: "Si corresponde", what: "Comunicar a los titulares cuando involucra datos sensibles, de niños, niñas y adolescentes o financieros." },
      { when: "30 días corridos", what: "Plazo para responder solicitudes de los titulares (prorrogable una vez por 30 días)." },
    ],
  },
];

const PRINCIPLES = [
  { icon: "lock" as const, title: "Confidencialidad", text: "No compartas información del caso fuera de las personas designadas. Nunca intentes identificar a un denunciante anónimo." },
  { icon: "users" as const, title: "Conflicto de interés", text: "Si tienes relación con alguna persona involucrada, abstente e infórmalo. El sistema oculta las denuncias en que estás involucrado." },
  { icon: "shield" as const, title: "No represalias", text: "Ninguna persona que denuncie de buena fe puede sufrir consecuencias negativas por hacerlo." },
  { icon: "activity" as const, title: "Registro de todo", text: "Deja constancia de cada diligencia, entrevista y decisión. Cada acceso a una denuncia queda registrado." },
];

/** Documentos de referencia para quienes gestionan denuncias. */
export function ResourcesPage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [data, setData] = useState<Resources | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Resources>(`${apiBase}/cases/resources`, { token })
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout]);

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Documentos del canal" }]} />
      <PageHeader
        title="Documentos del canal"
        description="Política del canal, procedimientos y plazos de cada ley, y principios que debe seguir toda persona que gestiona denuncias."
      />
      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Política del canal" description="Publicada por el administrador del canal para los denunciantes.">
            {!data ? (
              <p className="text-sm text-gray-500">Cargando…</p>
            ) : data.policy.trim() ? (
              <div className="text-[15px] leading-relaxed whitespace-pre-line text-gray-800">{data.policy}</div>
            ) : (
              <p className="text-sm text-gray-500">El administrador del canal aún no publica la política.</p>
            )}
          </Panel>

          <Panel
            title="Procedimientos y plazos por ley"
            description="Días hábiles: de lunes a viernes, sin feriados (DS 21/2024). El sistema calcula cada plazo en la ficha de la denuncia."
          >
            <div className="space-y-8">
              {GUIDES.map((g) => (
                <section key={g.key}>
                  <h3 className="text-[15px] font-semibold text-gray-900">{g.title}</h3>
                  <p className="text-xs text-gray-500">{g.subtitle}</p>
                  <ol className="mt-3 space-y-3">
                    {g.steps.map((st, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-28 shrink-0 pt-0.5 text-xs font-semibold text-highlight-text sm:w-32">{st.when}</span>
                        <span className="min-w-0 text-sm text-gray-700">{st.what}</span>
                      </li>
                    ))}
                  </ol>
                  {g.note && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 ring-1 ring-amber-600/15 ring-inset">{g.note}</p>
                  )}
                </section>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Principios de gestión">
            <ul className="space-y-5">
              {PRINCIPLES.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
                    <Icon name={p.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{p.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-gray-500">{p.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          {data && (
            <Panel title="Reglas de este canal">
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="text-gray-500">Modalidad de gestión</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {data.mode === "complete"
                      ? "Completa: quien investiga no aprueba su propio cierre"
                      : "Simplificada: una persona puede llevar todo el caso, con cierre fundamentado"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Plan ante conflicto de interés</dt>
                  <dd className="mt-1 font-medium text-gray-900">{data.hasConflictPlan ? "Definido" : "Sin definir"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Conservación de la información</dt>
                  <dd className="mt-1 font-medium text-gray-900">{data.retentionMonths / 12} años desde el cierre</dd>
                </div>
                {data.contactEmail && (
                  <div>
                    <dt className="text-gray-500">Contacto del canal</dt>
                    <dd className="mt-1 font-medium text-gray-900">{data.contactEmail}</dd>
                  </div>
                )}
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
