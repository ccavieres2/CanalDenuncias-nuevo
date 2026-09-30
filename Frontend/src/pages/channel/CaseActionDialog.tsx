import { type FormEvent, type ReactNode, useState } from "react";
import {
  Alert,
  Button,
  Field,
  Modal,
  Select,
  TextArea,
} from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { ACTION_UI } from "../../lib/case-actions";
import {
  type CaseAction,
  type CaseDetail,
  type CaseOptions,
  FINDINGS,
  MILESTONE_RESULT_LABEL,
  RELATION_OPTIONS,
} from "../../lib/cases";
import { formatDate } from "../../lib/ui-helpers";
import { useChannel } from "../../lib/channel-context";

const AUTHORITIES = [
  "la Dirección del Trabajo",
  "el Ministerio Público",
  "Carabineros o la PDI",
  "la Superintendencia correspondiente",
];

/** Qué pedir al registrar cada hito. */
const MILESTONE_HINT: Record<string, string> = {
  oal_referral:
    "Organismo administrador (mutual o ISL) y cómo se derivó a la persona afectada.",
  other_employer_notice:
    "A quién de la otra empresa se informó y por qué medio.",
  dt_start_notice:
    "N° de ticket del «Aviso de inicio de investigación» en el portal de la DT.",
  dt_referral:
    "N° de ticket de la «Derivación de denuncia» en el portal de la DT.",
  dt_report:
    "N° de ticket del «Depósito de investigación» en el portal de la DT.",
  dt_ruling: "Observaciones de la DT, si las hubo.",
  dt_result: "Conclusiones del informe de la DT.",
  measures_applied:
    "Medidas y sanciones aplicadas, y cómo se informó a la persona denunciante y a la denunciada.",
  breach_assessment: "Qué datos y cuántas personas se vieron afectadas.",
  agency_notice: "Medio y N° de ingreso del reporte a la Agencia.",
  holders_notice: "Cómo y cuándo se comunicó a los titulares.",
  prosecutor: "Fiscalía y N° de causa (RUC), o motivo para no denunciar.",
};

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(
    new Date(),
  );

const DEFAULT_REPORTER_MESSAGE =
  "Tu denuncia fue revisada y el caso quedó cerrado. Se adoptaron las medidas que correspondían según lo investigado. Gracias por informar: tu aporte ayuda a mejorar nuestro lugar de trabajo.";

export function CaseActionDialog({
  action,
  milestoneKey,
  intro,
  detail,
  options,
  onClose,
  onDone,
}: {
  action: CaseAction;
  /** Hito a registrar (acción «milestone»). */
  milestoneKey?: string;
  /** Texto de contexto sobre el formulario (p. ej., «Paso 1 de 3»). */
  intro?: ReactNode;
  detail: CaseDetail;
  options: CaseOptions | null;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const { token, apiBase } = useChannel();
  const ui = ACTION_UI[action];
  const [form, setForm] = useState<Record<string, string>>(() => ({
    authority:
      detail.category.framework === "ley_karin"
        ? AUTHORITIES[0]!
        : detail.category.framework === "ley_20393"
          ? AUTHORITIES[1]!
          : "",
    otherAuthority: "",
    type: "interview",
    finding: "",
    reporterMessage: DEFAULT_REPORTER_MESSAGE,
    investigatorId: "",
    categoryId: "",
    route: detail.reporterRequestsDt ? "dt" : (detail.route ?? ""),
    // Si la persona indicó que fue alguien de otra empresa o un tercero, se propone esa relación.
    companyRelation:
      detail.companyRelation ??
      (detail.offenderRelation === "other_company"
        ? "contractor"
        : detail.offenderRelation === "third_party"
          ? "third_party"
          : detail.offenderRelation
            ? "same"
            : ""),
    otherCompany: detail.otherCompany ?? "",
    date: today(),
    result: "",
    title: "",
    assignee: detail.investigator ? "investigator" : "case_manager",
    dueDate: "",
  }));
  const milestone = detail.deadlines.find((m) => m.key === milestoneKey);
  const results = milestoneKey
    ? options?.milestoneResults[milestoneKey]
    : undefined;
  const [involved, setInvolved] = useState<Set<string>>(
    () => new Set(detail.involvedUsers.map((u) => u.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const bind = (key: string) => ({
    value: form[key] ?? "",
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value),
  });

  function body(): Record<string, unknown> {
    switch (action) {
      case "assign":
        return { investigatorId: form.investigatorId };
      case "reclassify":
        return { categoryId: form.categoryId, reason: form.reason };
      case "measure":
      case "note":
        return { text: form.text };
      case "authority":
        return {
          authority: form.authority || form.otherAuthority,
          detail: form.detail,
        };
      case "diligence":
        return { type: form.type, text: form.text };
      case "propose":
        return { finding: form.finding, text: form.text };
      case "dismiss":
        return { reason: form.reason };
      case "approve":
        return {
          resolution: form.resolution,
          reporterMessage: form.reporterMessage,
        };
      case "reject":
        return { reason: form.reason };
      case "involve":
        return { userIds: [...involved], reason: form.reason };
      case "set_route":
        return {
          route: form.route,
          companyRelation: form.companyRelation,
          otherCompany: form.otherCompany,
          reason: form.reason,
        };
      case "add_task":
        return {
          title: form.title,
          detail: form.detail,
          assignee: form.assignee,
          dueDate: form.dueDate || undefined,
        };
      case "extend_deadline":
        return { key: milestoneKey, date: form.dueDate, reason: form.reason };
      case "milestone":
        return {
          key: milestoneKey,
          date: form.date,
          result: form.result || undefined,
          detail: form.detail,
          reporterMessage:
            milestoneKey === "measures_applied"
              ? form.reporterMessage
              : undefined,
        };
      default:
        return {};
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ summary: string }>(
        `${apiBase}/cases/${detail.id}/actions/${action}`,
        {
          method: "POST",
          token,
          body: body(),
        },
      );
      onDone(res.summary);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fields ? Object.values(err.fields) : [];
        setError(fields.length ? fields.join(". ") : err.message);
      } else setError("Error inesperado");
      setBusy(false);
    }
  }

  const proposalBox = detail.proposal && (
    <div className="rounded-lg bg-gray-50 px-4 py-3 ring-1 ring-gray-200/70 ring-inset">
      <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {detail.finding ? FINDINGS[detail.finding].label : "Propuesta"}
        {detail.proposedBy && ` · ${detail.proposedBy}`}
      </p>
      <p className="mt-1 text-sm whitespace-pre-line text-gray-800">
        {detail.proposal}
      </p>
    </div>
  );

  return (
    <Modal
      title={action === "milestone" && milestone ? milestone.label : ui.title}
      description={
        action === "milestone" && milestone
          ? `${milestone.detail}. ${milestone.basis}.`
          : ui.description
      }
      onClose={onClose}
      size={
        action === "propose" || action === "approve" || action === "set_route"
          ? "lg"
          : "md"
      }
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="case-action"
            variant={
              action === "dismiss" || action === "reject" ? "danger" : "primary"
            }
            loading={busy}
          >
            {ui.submit}
          </Button>
        </>
      }
    >
      <form id="case-action" onSubmit={submit} className="space-y-5">
        {intro}
        {error && <Alert>{error}</Alert>}

        {action === "start_review" && (
          <p className="text-sm text-gray-600">
            Mensaje que recibirá el denunciante: «Recibimos tu denuncia y ya
            está en revisión. Si necesitamos más antecedentes te escribiremos
            por este mismo medio…»
          </p>
        )}

        {action === "assign" && (
          <label className="block">
            <span className="block text-sm font-medium text-gray-800">
              Investigador
            </span>
            <div className="mt-2">
              <Select
                value={form.investigatorId!}
                onChange={set("investigatorId")}
                required
              >
                <option value="">Selecciona una persona</option>
                {options?.investigators.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.area ? ` · ${u.area}` : ""}
                    {u.id === detail.investigator?.id ? " (actual)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            {options?.investigators.length === 0 && (
              <span className="mt-2 block text-sm text-amber-700">
                Nadie puede investigar esta categoría. El administrador del
                canal debe dar el rol de investigador a una persona del área
                autorizada.
              </span>
            )}
          </label>
        )}

        {action === "reclassify" && (
          <>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800">
                Nueva categoría
              </span>
              <div className="mt-2">
                <Select
                  value={form.categoryId!}
                  onChange={set("categoryId")}
                  required
                >
                  <option value="">Selecciona una categoría</option>
                  {options?.categories
                    .filter((c) => c.id !== detail.category.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </div>
            </label>
            <TextArea
              label="Motivo"
              required
              {...bind("reason")}
              placeholder="Por qué corresponde a esta categoría"
            />
          </>
        )}

        {(action === "measure" || action === "note") && (
          <TextArea
            label={action === "measure" ? "Medida adoptada" : "Nota"}
            required
            rows={4}
            {...bind("text")}
            placeholder={
              action === "measure"
                ? "Ej.: separación de espacios físicos y cambio de turno de la persona denunciante."
                : ""
            }
          />
        )}

        {action === "authority" && (
          <>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800">
                Autoridad
              </span>
              <div className="mt-2">
                <Select value={form.authority!} onChange={set("authority")}>
                  {AUTHORITIES.map((a) => (
                    <option key={a} value={a}>
                      {a[0]!.toUpperCase() + a.slice(1)}
                    </option>
                  ))}
                  <option value="">Otra autoridad</option>
                </Select>
              </div>
            </label>
            {!form.authority && (
              <Field label="¿Cuál?" required {...bind("otherAuthority")} />
            )}
            <TextArea
              label="Detalle (opcional)"
              {...bind("detail")}
              placeholder="N° de ingreso, folio o medio por el que se informó."
            />
          </>
        )}

        {action === "diligence" && (
          <>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800">
                Tipo
              </span>
              <div className="mt-2">
                <Select value={form.type!} onChange={set("type")}>
                  <option value="interview">Entrevista</option>
                  <option value="document">Revisión documental</option>
                  <option value="inspection">
                    Inspección o verificación en terreno
                  </option>
                  <option value="other">Otra diligencia</option>
                </Select>
              </div>
            </label>
            <TextArea
              label="Detalle"
              required
              rows={5}
              {...bind("text")}
              placeholder="A quién se entrevistó o qué se revisó, y lo que se obtuvo."
            />
          </>
        )}

        {action === "propose" && (
          <>
            <fieldset>
              <legend className="text-sm font-medium text-gray-800">
                Conclusión
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(
                  ["substantiated", "partially", "unsubstantiated"] as const
                ).map((f) => (
                  <label
                    key={f}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset transition ${
                      form.finding === f
                        ? "bg-accent-soft font-medium text-gray-900 ring-highlight"
                        : "ring-line hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="finding"
                      value={f}
                      checked={form.finding === f}
                      onChange={() => set("finding")(f)}
                      className="accent-[var(--color-highlight)]"
                      required
                    />
                    {FINDINGS[f].label}
                  </label>
                ))}
              </div>
            </fieldset>
            <TextArea
              label="Informe de la investigación"
              required
              rows={8}
              {...bind("text")}
              placeholder="Hechos investigados, diligencias realizadas, pruebas, conclusiones y medidas o sanciones que recomiendas."
            />
          </>
        )}

        {action === "dismiss" && (
          <TextArea
            label="Fundamento"
            required
            rows={5}
            {...bind("reason")}
            placeholder="Por qué la denuncia no tiene fundamento o no corresponde a este canal."
          />
        )}

        {action === "approve" && (
          <>
            {proposalBox}
            <TextArea
              label="Resolución"
              required
              rows={5}
              {...bind("resolution")}
              placeholder="Decisión final: medidas, sanciones o acciones correctivas que se aplicarán."
            />
            <TextArea
              label="Respuesta al denunciante"
              rows={4}
              {...bind("reporterMessage")}
              hint="Se envía por el buzón seguro. No incluyas datos de otras personas; déjalo vacío para no enviar mensaje."
            />
          </>
        )}

        {action === "reject" && (
          <>
            {proposalBox}
            <TextArea
              label="Observaciones"
              required
              rows={5}
              {...bind("reason")}
              placeholder="Qué falta investigar o fundamentar."
            />
          </>
        )}

        {action === "set_route" && (
          <>
            <fieldset>
              <legend className="text-sm font-medium text-gray-800">
                ¿Quién investiga?
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[
                  {
                    value: "internal",
                    title: "La empresa (investigación interna)",
                    text: "Avisar a la DT del inicio y las medidas en 3 días hábiles. Concluir en 30 días hábiles y enviar el informe a la DT.",
                  },
                  {
                    value: "dt",
                    title: "La Dirección del Trabajo",
                    text: "Derivar la denuncia con sus antecedentes en 3 días hábiles. La empresa aplica las medidas que resulten.",
                  },
                ].map((o) => {
                  const disabled =
                    o.value === "internal" && detail.reporterRequestsDt;
                  return (
                    <label
                      key={o.value}
                      className={`flex gap-3 rounded-lg px-3.5 py-3 ring-1 ring-inset transition ${
                        disabled
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer"
                      } ${form.route === o.value ? "bg-accent-soft ring-2 ring-highlight" : "ring-line hover:bg-gray-50"}`}
                    >
                      <input
                        type="radio"
                        name="route"
                        disabled={disabled}
                        checked={form.route === o.value}
                        onChange={() => set("route")(o.value)}
                        className="mt-1 accent-[var(--color-highlight)]"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">
                          {o.title}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
                          {o.text}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {detail.reporterRequestsDt && (
                <p className="mt-2 text-sm text-amber-700">
                  El denunciante pidió que investigue la DT: la ley obliga a
                  derivarla.
                </p>
              )}
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium text-gray-800">
                ¿Qué empresas están involucradas?
              </legend>
              <div className="mt-2 grid gap-2">
                {RELATION_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={`flex cursor-pointer gap-3 rounded-lg px-3.5 py-2.5 ring-1 ring-inset transition ${
                      form.companyRelation === o.value
                        ? "bg-accent-soft ring-2 ring-highlight"
                        : "ring-line hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="relation"
                      checked={form.companyRelation === o.value}
                      onChange={() => set("companyRelation")(o.value)}
                      className="mt-1 accent-[var(--color-highlight)]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">
                        {o.label}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {o.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {(form.companyRelation === "contractor" ||
              form.companyRelation === "principal") && (
              <Field
                label="Nombre de la otra empresa"
                required
                {...bind("otherCompany")}
                maxLength={150}
              />
            )}
            <TextArea
              label="Fundamento (opcional)"
              {...bind("reason")}
              placeholder="Por qué se eligió este procedimiento."
            />
          </>
        )}

        {action === "milestone" && milestone && (
          <>
            {milestone.dueAt && (
              <p className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-sm text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                Plazo:{" "}
                <strong className="text-gray-900">
                  {formatDate(milestone.dueAt)}
                </strong>
              </p>
            )}
            <Field
              label="Fecha en que se cumplió"
              type="date"
              required
              max={today()}
              {...bind("date")}
            />
            {results && (
              <label className="block">
                <span className="block text-sm font-medium text-gray-800">
                  Resultado
                </span>
                <div className="mt-2">
                  <Select
                    value={form.result!}
                    onChange={set("result")}
                    required
                  >
                    <option value="">Selecciona el resultado</option>
                    {results.map((r) => (
                      <option key={r} value={r}>
                        {MILESTONE_RESULT_LABEL[r] ?? r}
                      </option>
                    ))}
                  </Select>
                </div>
              </label>
            )}
            <TextArea
              label={
                milestoneKey === "measures_applied"
                  ? "Medidas y sanciones aplicadas"
                  : "Detalle (opcional)"
              }
              required={milestoneKey === "measures_applied"}
              rows={4}
              {...bind("detail")}
              placeholder={MILESTONE_HINT[milestoneKey ?? ""] ?? ""}
            />
            {milestoneKey === "measures_applied" && detail.origin !== "dt" && (
              <TextArea
                label="Respuesta al denunciante (opcional)"
                rows={3}
                {...bind("reporterMessage")}
                hint="Se envía por el buzón seguro al cerrar la denuncia. Déjalo vacío para no enviar mensaje."
              />
            )}
          </>
        )}

        {action === "add_task" && (
          <>
            <Field
              label="Tarea"
              required
              maxLength={120}
              {...bind("title")}
              placeholder="Ej.: Pedir a TI el registro de accesos del sistema"
            />
            <TextArea
              label="Detalle (opcional)"
              rows={3}
              maxLength={1000}
              {...bind("detail")}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="block text-sm font-medium text-gray-800">
                  A cargo de
                </span>
                <div className="mt-2">
                  <Select value={form.assignee!} onChange={set("assignee")}>
                    <option value="case_manager">Gestor de denuncias</option>
                    <option value="investigator">Investigador</option>
                  </Select>
                </div>
              </label>
              <Field
                label="Plazo (opcional)"
                type="date"
                min={today()}
                {...bind("dueDate")}
              />
            </div>
          </>
        )}

        {action === "extend_deadline" && milestone && (
          <>
            <p className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-sm text-gray-600 ring-1 ring-gray-200/70 ring-inset">
              <strong className="text-gray-900">{milestone.label}</strong>
              <br />
              Plazo actual:{" "}
              {milestone.dueAt ? formatDate(milestone.dueAt) : "sin plazo"}
            </p>
            <Field
              label="Nuevo plazo"
              type="date"
              required
              min={today()}
              {...bind("dueDate")}
            />
            <TextArea
              label="Motivo"
              required
              rows={3}
              minLength={10}
              maxLength={1000}
              {...bind("reason")}
              placeholder="Ej.: El testigo principal está con licencia médica hasta el 20 de octubre."
            />
          </>
        )}

        {action === "involve" && (
          <ul className="max-h-80 divide-y divide-line-soft overflow-y-auto rounded-lg ring-1 ring-line ring-inset">
            {options?.users.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={involved.has(u.id)}
                    onChange={(e) =>
                      setInvolved((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(u.id);
                        else next.delete(u.id);
                        return next;
                      })
                    }
                    className="size-4 accent-[var(--color-highlight)]"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-gray-900">
                      {u.name}
                    </span>
                    {u.area && (
                      <span className="block text-gray-500">{u.area}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {action === "involve" && detail.involvedUsers.some((u) => !involved.has(u.id)) && (
          <TextArea
            label="Motivo para quitar a alguien de las personas excluidas"
            required
            rows={2}
            minLength={5}
            maxLength={500}
            {...bind("reason")}
            placeholder="Ej.: Coincidencia de nombre con otra persona; no está involucrado."
            hint="Queda en la bitácora del caso."
          />
        )}
      </form>
    </Modal>
  );
}
