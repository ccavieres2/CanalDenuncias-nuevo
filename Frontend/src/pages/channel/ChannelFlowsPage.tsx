import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ConfirmModal } from "../../components/dialogs";
import {
  Alert,
  Breadcrumbs,
  Button,
  Field,
  Icon,
  PageHeader,
  Panel,
  Select,
  TextArea,
  Toggle,
} from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import { FRAMEWORKS } from "../../lib/roles";
import { formatDate } from "../../lib/ui-helpers";

type FlowFramework = "ley_20393" | "ley_21719" | "internal";
type Tab = "ley_karin" | FlowFramework;
type DayKind = "calendar" | "business";
type Owner = "case_manager" | "investigator";

interface FlowStep {
  key: string;
  title: string;
  description: string | null;
  days: number | null;
  dayKind: DayKind;
  required: boolean;
  owner: Owner;
}

interface FlowConfig {
  ackDays: number;
  closureDays: number;
  dayKind: DayKind;
  steps: FlowStep[];
}

interface FlowView {
  framework: FlowFramework;
  version: number | null;
  config: FlowConfig;
  updatedAt: string | null;
  updatedBy: string | null;
  lawSteps: { label: string; detail: string }[];
  history: {
    version: number;
    note: string | null;
    createdAt: string | null;
    createdBy: string | null;
    openCases: number;
  }[];
}

interface Overview {
  flows: FlowView[];
  defaultConfig: FlowConfig;
}

/** Borrador del formulario: los números como texto para poder editarlos libremente. */
interface DraftStep {
  key: string;
  title: string;
  description: string;
  days: string;
  dayKind: DayKind;
  required: boolean;
  owner: Owner;
}
interface Draft {
  ackDays: string;
  closureDays: string;
  dayKind: DayKind;
  steps: DraftStep[];
}

const TABS: Tab[] = ["ley_karin", "ley_20393", "ley_21719", "internal"];

const toDraft = (c: FlowConfig): Draft => ({
  ackDays: String(c.ackDays),
  closureDays: String(c.closureDays),
  dayKind: c.dayKind,
  steps: c.steps.map((s) => ({
    ...s,
    description: s.description ?? "",
    days: s.days === null ? "" : String(s.days),
  })),
});

const toConfig = (d: Draft) => ({
  ackDays: Number(d.ackDays),
  closureDays: Number(d.closureDays),
  dayKind: d.dayKind,
  steps: d.steps.map((s) => ({
    key: s.key,
    title: s.title.trim(),
    description: s.description.trim() || null,
    days: s.days === "" ? null : Number(s.days),
    dayKind: s.dayKind,
    required: s.required,
    owner: s.owner,
  })),
});

const numeric = (v: string) => v.replace(/\D/g, "").slice(0, 3);

/** Pasos legales de Ley Karin (solo lectura; el detalle completo está en «Flujo de denuncias»). */
const KARIN_STEPS = [
  "Medidas de resguardo y derivación al organismo administrador: inmediatas",
  "Decidir quién investiga (la empresa o la DT) y avisar a la DT: 3 días hábiles",
  "Investigación interna: 30 días hábiles; informe a la DT en 2 días hábiles",
  "Pronunciamiento de la DT: 30 días hábiles",
  "Aplicar medidas y sanciones: 15 días corridos",
];

/**
 * Flujos de gestión de la empresa (solo client_admin). Ley Karin es de solo lectura; en los demás marcos se ajustan
 * los plazos de referencia y se agregan pasos propios. Cada cambio es una versión nueva que aplica a denuncias nuevas.
 */
export function ChannelFlowsPage() {
  const { token, apiBase, basePath, logout } = useChannel();
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("internal");
  const [drafts, setDrafts] = useState<Partial<Record<FlowFramework, Draft>>>(
    {},
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    api<Overview>(`${apiBase}/console/flows`, { token })
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout]);

  const flow =
    tab === "ley_karin"
      ? null
      : (data?.flows.find((f) => f.framework === tab) ?? null);
  const draft = flow ? (drafts[flow.framework] ?? toDraft(flow.config)) : null;
  const dirty = useMemo(
    () =>
      !!flow &&
      !!draft &&
      // Se comparan en la misma forma: la base devuelve las claves en otro orden.
      JSON.stringify(toConfig(draft)) !==
        JSON.stringify(toConfig(toDraft(flow.config))),
    [flow, draft],
  );

  function update(next: Draft) {
    if (!flow) return;
    setDrafts((d) => ({ ...d, [flow.framework]: next }));
    setFlash(null);
  }
  const setStep = (i: number, patch: Partial<DraftStep>) =>
    draft &&
    update({
      ...draft,
      steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  const moveStep = (i: number, delta: number) => {
    if (!draft) return;
    const steps = [...draft.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + delta, 0, s!);
    update({ ...draft, steps });
  };

  async function save(reset = false) {
    if (!flow || !draft) return;
    setSaving(true);
    setError(null);
    setFieldErrors([]);
    setFlash(null);
    try {
      const res = await api<Overview>(
        `${apiBase}/console/flows/${flow.framework}`,
        {
          method: "PUT",
          token,
          body: {
            config: reset ? data!.defaultConfig : toConfig(draft),
            note: note.trim() || null,
            reset,
          },
        },
      );
      setData(res);
      setDrafts((d) => ({ ...d, [flow.framework]: undefined }));
      setNote("");
      const v = res.flows.find((f) => f.framework === flow.framework)?.version;
      setFlash(
        `${reset ? "Se restauró el flujo recomendado" : "Flujo guardado"} como versión ${v}. Aplica a las denuncias nuevas; las que están en curso siguen con su versión.`,
      );
      setConfirmReset(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return logout();
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFieldErrors(
        err instanceof ApiError && err.fields ? Object.values(err.fields) : [],
      );
      setConfirmReset(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Inicio", to: basePath },
          { label: "Flujos de gestión" },
        ]}
      />
      <PageHeader
        title="Flujos de gestión"
        description="Define cómo gestiona tu empresa cada tipo de denuncia: plazos de referencia y pasos propios. Los cambios aplican a las denuncias nuevas; las que están en curso siguen con la versión con que partieron."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: "settings" as const,
            title: "Tú (administrador)",
            text: "Editas las plantillas de cada tipo de denuncia.",
          },
          {
            icon: "users" as const,
            title: "Gestor de denuncias",
            text: "En cada caso puede agregar tareas y extender plazos internos, siempre con motivo.",
          },
          {
            icon: "lock" as const,
            title: "Plazos legales",
            text: "Nadie puede cambiarlos: los fija la ley.",
          },
        ].map((x) => (
          <div
            key={x.title}
            className="flex gap-3 rounded-xl bg-white p-4 ring-1 ring-line ring-inset"
          >
            <Icon
              name={x.icon}
              className="mt-0.5 size-4 shrink-0 text-highlight-text"
            />
            <p className="text-sm">
              <span className="block font-semibold text-gray-900">
                {x.title}
              </span>
              <span className="text-gray-500">{x.text}</span>
            </p>
          </div>
        ))}
      </div>

      <div
        role="tablist"
        className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setError(null);
              setFieldErrors([]);
              setFlash(null);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition ${
              tab === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {t === "ley_karin" && <Icon name="lock" className="size-3.5" />}
            {FRAMEWORKS[t].label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6">
          <Alert>
            {error}
            {fieldErrors.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {fieldErrors.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}
      {flash && (
        <div className="mb-6">
          <Alert type="success">{flash}</Alert>
        </div>
      )}

      {!data ? (
        !error && (
          <p className="py-16 text-center text-sm text-gray-500">Cargando…</p>
        )
      ) : tab === "ley_karin" ? (
        <Panel
          title="Ley Karin: procedimiento fijado por la ley"
          description="La Ley 21.643 y su reglamento (DS 21/2024) establecen los pasos y plazos. No se pueden modificar para evitar incumplimientos."
        >
          <ul className="space-y-3">
            {KARIN_STEPS.map((s) => (
              <li
                key={s}
                className="flex items-start gap-2.5 text-sm text-gray-700"
              >
                <Icon
                  name="lock"
                  className="mt-0.5 size-3.5 shrink-0 text-gray-400"
                />
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-gray-500">
            En cada caso, el gestor sí puede agregar tareas propias (por
            ejemplo, entrevistas o informes adicionales).{" "}
            <Link
              to={`${basePath}/flows`}
              className="font-semibold text-highlight-text hover:underline"
            >
              Ver el flujo completo
            </Link>
          </p>
        </Panel>
      ) : (
        flow &&
        draft && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <Panel
                title="Plazos de referencia"
                description="Buena práctica ISO 37002: acuse de recibo en 7 días y respuesta al denunciante en 3 meses (90 días). No son plazos legales."
              >
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field
                    label="Acuse de recibo (días)"
                    inputMode="numeric"
                    value={draft.ackDays}
                    onChange={(e) =>
                      update({ ...draft, ackDays: numeric(e.target.value) })
                    }
                    hint="Entre 1 y 30"
                  />
                  <Field
                    label="Respuesta y cierre (días)"
                    inputMode="numeric"
                    value={draft.closureDays}
                    onChange={(e) =>
                      update({ ...draft, closureDays: numeric(e.target.value) })
                    }
                    hint="Entre 15 y 365"
                  />
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-800">
                      Tipo de días
                    </span>
                    <div className="mt-2">
                      <Select
                        value={draft.dayKind}
                        onChange={(v) =>
                          update({ ...draft, dayKind: v as DayKind })
                        }
                      >
                        <option value="calendar">Corridos</option>
                        <option value="business">Hábiles</option>
                      </Select>
                    </div>
                  </label>
                </div>
              </Panel>

              {flow.lawSteps.length > 0 && (
                <Panel
                  title="Hitos legales"
                  description="Los exige la ley para este tipo de denuncia: se incluyen siempre y no se pueden quitar."
                >
                  <ul className="space-y-3">
                    {flow.lawSteps.map((s) => (
                      <li
                        key={s.label}
                        className="flex items-start gap-2.5 text-sm"
                      >
                        <Icon
                          name="lock"
                          className="mt-0.5 size-3.5 shrink-0 text-gray-400"
                        />
                        <span>
                          <span className="block font-medium text-gray-900">
                            {s.label}
                          </span>
                          <span className="text-gray-500">{s.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel
                title="Pasos propios de la empresa"
                description="Se agregan a cada denuncia nueva de este tipo, antes de la respuesta final. Los obligatorios deben registrarse para poder aprobar el cierre."
              >
                {draft.steps.length === 0 ? (
                  <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                    Sin pasos propios. Ejemplos: «Informar al Comité de Ética»,
                    «Revisión de Gerencia Legal», «Entrevista con la jefatura
                    del área».
                  </p>
                ) : (
                  <ol className="space-y-4">
                    {draft.steps.map((st, i) => (
                      <li
                        key={st.key || `nuevo-${i}`}
                        className="rounded-xl p-4 ring-1 ring-line ring-inset"
                      >
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                            Paso {i + 1}
                          </span>
                          <span className="flex gap-1">
                            <IconButton
                              label="Subir"
                              disabled={i === 0}
                              onClick={() => moveStep(i, -1)}
                              rotate="-rotate-90"
                            />
                            <IconButton
                              label="Bajar"
                              disabled={i === draft.steps.length - 1}
                              onClick={() => moveStep(i, 1)}
                              rotate="rotate-90"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                update({
                                  ...draft,
                                  steps: draft.steps.filter((_, j) => j !== i),
                                })
                              }
                              className="rounded-md px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              Quitar
                            </button>
                          </span>
                        </div>
                        <div className="space-y-4">
                          <Field
                            label="Nombre del paso"
                            value={st.title}
                            maxLength={120}
                            onChange={(e) =>
                              setStep(i, { title: e.target.value })
                            }
                            placeholder="Ej.: Informar al Comité de Ética"
                          />
                          <TextArea
                            label="Descripción (opcional)"
                            rows={2}
                            maxLength={500}
                            value={st.description}
                            onChange={(e) =>
                              setStep(i, { description: e.target.value })
                            }
                          />
                          <div className="grid gap-4 sm:grid-cols-3">
                            <Field
                              label="Plazo (días desde la recepción)"
                              inputMode="numeric"
                              value={st.days}
                              placeholder="Sin plazo"
                              onChange={(e) =>
                                setStep(i, { days: numeric(e.target.value) })
                              }
                            />
                            <label className="block">
                              <span className="block text-sm font-medium text-gray-800">
                                Tipo de días
                              </span>
                              <div className="mt-2">
                                <Select
                                  value={st.dayKind}
                                  onChange={(v) =>
                                    setStep(i, { dayKind: v as DayKind })
                                  }
                                >
                                  <option value="calendar">Corridos</option>
                                  <option value="business">Hábiles</option>
                                </Select>
                              </div>
                            </label>
                            <label className="block">
                              <span className="block text-sm font-medium text-gray-800">
                                Lo registra
                              </span>
                              <div className="mt-2">
                                <Select
                                  value={st.owner}
                                  onChange={(v) =>
                                    setStep(i, { owner: v as Owner })
                                  }
                                >
                                  <option value="case_manager">
                                    Gestor de denuncias
                                  </option>
                                  <option value="investigator">
                                    Investigador
                                  </option>
                                </Select>
                              </div>
                            </label>
                          </div>
                          <Toggle
                            checked={st.required}
                            onChange={(v) => setStep(i, { required: v })}
                            label="Obligatorio"
                            description="Si falta, el comité no puede aprobar el cierre (salvo que la denuncia se desestime)."
                          />
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                <Button
                  type="button"
                  className="mt-4"
                  disabled={draft.steps.length >= 15}
                  onClick={() =>
                    update({
                      ...draft,
                      steps: [
                        ...draft.steps,
                        {
                          key: "",
                          title: "",
                          description: "",
                          days: "",
                          dayKind: "business",
                          required: true,
                          owner: "case_manager",
                        },
                      ],
                    })
                  }
                >
                  <Icon name="plus" />
                  Agregar paso
                </Button>
              </Panel>

              <Panel title="Guardar cambios">
                <div className="space-y-4">
                  <Field
                    label="Motivo del cambio (opcional)"
                    value={note}
                    maxLength={300}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ej.: Aprobado por el Comité de Ética el 10/10/2026"
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="primary"
                      loading={saving}
                      disabled={!dirty}
                      onClick={() => save(false)}
                    >
                      Guardar nueva versión
                    </Button>
                    {dirty && (
                      <Button
                        onClick={() =>
                          setDrafts((d) => ({
                            ...d,
                            [flow.framework]: undefined,
                          }))
                        }
                      >
                        Descartar cambios
                      </Button>
                    )}
                    {flow.version !== null && (
                      <Button
                        variant="link"
                        onClick={() => setConfirmReset(true)}
                      >
                        Restaurar el flujo recomendado
                      </Button>
                    )}
                  </div>
                </div>
              </Panel>
            </div>

            <aside className="xl:sticky xl:top-24">
              <Panel
                title="Versiones"
                description="Se conservan todas: cada denuncia sigue la versión con que partió."
              >
                <ol className="space-y-4">
                  {flow.history.map((h, i) => (
                    <li key={h.version} className="text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                        {h.version === 0
                          ? "Recomendado"
                          : `Versión ${h.version}`}
                        {i === 0 && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20 ring-inset">
                            Vigente
                          </span>
                        )}
                      </p>
                      <p className="text-gray-500">
                        {h.createdAt
                          ? `${formatDate(h.createdAt, true)}${h.createdBy ? ` · ${h.createdBy}` : ""}`
                          : "Flujo base de la plataforma"}
                      </p>
                      {h.note && h.version !== 0 && (
                        <p className="mt-0.5 text-gray-600">«{h.note}»</p>
                      )}
                      <p className="mt-0.5 text-xs text-gray-500">
                        {h.openCases === 0
                          ? "Sin denuncias abiertas"
                          : `${h.openCases} ${h.openCases === 1 ? "denuncia abierta" : "denuncias abiertas"}`}
                      </p>
                    </li>
                  ))}
                </ol>
              </Panel>
            </aside>
          </div>
        )
      )}

      {confirmReset && flow && (
        <ConfirmModal
          title="¿Restaurar el flujo recomendado?"
          confirmLabel="Restaurar"
          onConfirm={() => save(true)}
          onClose={() => setConfirmReset(false)}
        >
          <p>
            Se creará una versión nueva sin pasos propios y con los plazos de
            referencia de ISO 37002. Las denuncias en curso no cambian.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  rotate,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  rotate: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
    >
      <Icon name="chevron" className={`size-3.5 ${rotate}`} />
    </button>
  );
}
