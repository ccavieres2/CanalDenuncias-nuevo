import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { MessageComposer, MessageThread } from "../../components/MessageThread";
import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  EmptyState,
  Icon,
  KeyValue,
  PageHeader,
  Panel,
} from "../../components/ui";
import { ApiError, api, downloadFile } from "../../lib/api";
import { ACTION_UI } from "../../lib/case-actions";
import {
  CASE_VIEW,
  type CaseAction,
  type CaseDetail,
  type CaseFile,
  type CaseResponse,
  type CaseRole,
  DUE_STYLES,
  FINDINGS,
  CHANNEL_LABEL,
  MILESTONE_RESULT_LABEL,
  type Milestone,
  ORIGIN_LABEL,
  OFFENDER_LABEL,
  ONGOING_LABEL,
  ROUTE_LABEL,
  STATUS,
  STATUS_ORDER,
  dueState,
  isOverdue,
} from "../../lib/cases";
import { useChannel } from "../../lib/channel-context";
import { planHas } from "../../lib/plans";
import { FRAMEWORKS, ROLES } from "../../lib/roles";
import { formatBytes, formatDate } from "../../lib/ui-helpers";
import { CaseActionDialog } from "./CaseActionDialog";
import { DemoTag } from "./CasesPage";

type IconName = Parameters<typeof Icon>[0]["name"];

const EVENT_ICONS: Record<string, IconName> = {
  measure: "shield",
  diligence: "search",
  note: "pencil",
  authority: "building",
  decision: "check",
  message: "mail",
  evidence: "paperclip",
};

/**
 * Evidencias que adjuntó el denunciante. Se descargan siempre como archivo (nunca se abren dentro de la app) y cada
 * descarga queda auditada. El auditor ve que existen, sin nombre ni acceso al contenido.
 */
function CaseFilesPanel({
  files,
  canDownload,
  basePath,
  token,
  isAnonymous,
}: {
  files: CaseFile[];
  canDownload: boolean;
  basePath: string;
  token: string | null;
  isAnonymous: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(f: CaseFile) {
    setError(null);
    setBusy(f.id);
    try {
      await downloadFile(`${basePath}/${f.id}`, f.name, token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Evidencias del denunciante"
      description={
        canDownload
          ? "Archivos que el denunciante adjuntó desde su seguimiento. Cada descarga queda registrada."
          : "Contenido reservado: ves cuántos archivos hay y cuándo llegaron."
      }
      counter={files.length}
    >
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {files.length === 0 ? (
        <p className="text-sm text-gray-500">
          El denunciante aún no adjunta archivos. Puede hacerlo desde su seguimiento mientras la denuncia esté abierta.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-lg ring-1 ring-line ring-inset">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
              <Icon name="paperclip" className="size-4 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-gray-800">{f.name}</span>
                <span className="block text-xs text-gray-500">
                  {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt, true)}
                </span>
                {f.sha256 && (
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-400" title="Huella SHA-256 al recibirlo">
                    SHA-256 {f.sha256}
                  </span>
                )}
              </span>
              {canDownload && (
                <Button onClick={() => download(f)} loading={busy === f.id} className="w-full sm:w-auto">
                  <Icon name="download" />
                  Descargar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canDownload && files.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          Revisa los archivos en un equipo con antivirus actualizado.
          {isAnonymous && " El denunciante es anónimo: no intentes identificarlo a partir de los datos de los archivos."}
        </p>
      )}
    </Panel>
  );
}

/** Qué se espera del rol activo en la etapa actual. */
function nextStep(role: CaseRole, c: CaseDetail): string | null {
  if (c.status === "closed") return null;
  const karin = c.category.framework === "ley_karin";
  if (role === "case_manager") {
    const pending = c.deadlines.find(
      (m) => !m.done && m.registrable && !m.external && m.dueAt,
    );
    if (karin && !c.route && c.origin !== "dt") {
      return c.reporterRequestsDt
        ? "El denunciante pidió que investigue la DT: define el procedimiento y deriva la denuncia dentro de 3 días hábiles."
        : "Ley Karin: adopta medidas de resguardo y define dentro de 3 días hábiles si investiga la empresa o la DT.";
    }
    if (c.status === "follow_up") {
      return pending
        ? `Siguiente paso legal: ${pending.label.toLowerCase()}.`
        : "Esperando a la Dirección del Trabajo. Registra su respuesta cuando llegue.";
    }
    if (c.status === "received")
      return "Inicia la revisión: el denunciante recibirá el acuse de recibo.";
    if (c.status === "in_review") {
      return karin
        ? "Asigna al investigador y registra el aviso de inicio a la DT. En Ley Karin toda denuncia se investiga."
        : "Asigna un investigador o, si no tiene fundamento, propón desestimarla.";
    }
    if (c.status === "investigating")
      return "El investigador está trabajando. Puedes registrar medidas o escribir al denunciante.";
    if (c.status === "resolution")
      return "El comité está revisando la conclusión.";
    if (karin && pending)
      return `Plazo legal pendiente: ${pending.label.toLowerCase()}.`;
  }
  if (role === "investigator" && c.status === "investigating") {
    return "Registra las diligencias y, cuando termines, propón la conclusión al comité.";
  }
  if (role === "resolver" && c.status === "resolution") {
    return (
      c.approveBlockedReason ??
      (karin
        ? "Revisa el informe. Si lo apruebas, queda como informe final: se envía a la DT y luego se aplican las medidas."
        : "Revisa el informe y aprueba el cierre o devuélvelo con observaciones.")
    );
  }
  return null;
}

// Acción principal según el rol (se muestra destacada); el resto va como secundarias.
const PRIMARY: CaseAction[] = ["start_review", "assign", "propose", "approve"];

/** Ficha de una denuncia. Misma vista para todos los roles; contenido y acciones según el rol activo. */
export function CaseDetailPage() {
  const { id = "" } = useParams();
  const { user, plan, token, apiBase, basePath, logout } = useChannel();
  const role = user.activeRole as CaseRole;
  const [data, setData] = useState<CaseResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    action: CaseAction;
    milestoneKey?: string;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    api<CaseResponse>(`${apiBase}/cases/${id}`, { token })
      .then((res) => {
        setData(res);
        setNotFound(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        if (err instanceof ApiError && err.status === 404)
          return setNotFound(true);
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [apiBase, token, logout, id, role, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  async function sendMessage(body: string) {
    await api(`${apiBase}/cases/${id}/actions/message`, {
      method: "POST",
      token,
      body: { body },
    });
    reload();
  }

  const crumbs = [
    { label: "Inicio", to: basePath },
    { label: CASE_VIEW[role].menu, to: `${basePath}/cases` },
    { label: data?.case.code ?? "Denuncia" },
  ];

  if (notFound) {
    return (
      <>
        <Breadcrumbs items={crumbs} />
        {flash && (
          <div className="mb-6">
            <Alert type="success">{flash}</Alert>
          </div>
        )}
        <Panel>
          <EmptyState
            title="Denuncia no disponible"
            description="No existe, no corresponde a tu rol actual o ya no está a tu cargo. Si tienes otro rol, cámbialo desde tu menú de usuario."
          />
        </Panel>
      </>
    );
  }
  if (!data)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="py-16 text-center text-sm text-gray-500">Cargando…</p>
    );

  const c = data.case;
  const due = dueState(c);
  const readOnly = !c.permissions.viewContent;
  const currentStep = STATUS_ORDER.indexOf(c.status);
  const step = nextStep(role, c);
  const karin = c.category.framework === "ley_karin";
  const primary = c.actions.filter(
    (a) => PRIMARY.includes(a) && a !== "message",
  );
  const secondary = c.actions.filter(
    (a) =>
      !PRIMARY.includes(a) &&
      ![
        "message",
        "reject",
        "milestone",
        "add_task",
        "extend_deadline",
      ].includes(a),
  );
  // «En seguimiento» solo existe en Ley Karin.
  // Si investiga la DT, la empresa no pasa por investigación interna ni por el comité.
  const stages = STATUS_ORDER.filter(
    (s) =>
      (s !== "follow_up" || karin || c.status === "follow_up") &&
      !(c.route === "dt" && (s === "investigating" || s === "resolution")) &&
      !(c.origin === "dt" && s === "in_review"),
  );
  const canMessage = c.actions.includes("message");

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <PageHeader
        title={c.subject}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-sm">{c.code}</span>
            <Badge {...STATUS[c.status]} />
            {c.origin !== "portal" && (
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {ORIGIN_LABEL[c.origin]}
              </span>
            )}
            {karin && c.route && (
              <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                {ROUTE_LABEL[c.route]}
              </span>
            )}
            {c.isDemo && <DemoTag />}
          </span>
        }
      />

      {flash && (
        <div className="mb-6">
          <Alert type="success">{flash}</Alert>
        </div>
      )}

      {/* Etapas */}
      <Panel>
        <ol
          className={`grid gap-3 ${{ 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6" }[stages.length]}`}
        >
          {stages.map((s) => {
            const i = STATUS_ORDER.indexOf(s);
            const state =
              i < currentStep || c.status === "closed"
                ? "done"
                : i === currentStep
                  ? "current"
                  : "next";
            return (
              <li
                key={s}
                className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
              >
                <span
                  className={`h-1.5 w-10 shrink-0 rounded-full sm:w-full ${
                    state === "done"
                      ? "bg-emerald-500"
                      : state === "current"
                        ? "bg-highlight"
                        : "bg-gray-200"
                  }`}
                />
                <span
                  className={`text-sm ${state === "current" ? "font-semibold text-gray-900" : "text-gray-500"}`}
                >
                  {STATUS[s].label}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {/* Resultado */}
          {(c.proposal || c.outcome) && (
            <Panel
              title={
                c.status === "closed" ? "Resolución" : "Conclusión propuesta"
              }
            >
              <div className="space-y-4">
                {c.finding && (
                  <span
                    className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${FINDINGS[c.finding].styles}`}
                  >
                    {FINDINGS[c.finding].label}
                  </span>
                )}
                {c.proposal && (
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                      {c.finding === "inadmissible" ? "Fundamento" : "Informe"}
                      {c.proposedBy && ` · ${c.proposedBy}`}
                      {c.proposedAt && ` · ${formatDate(c.proposedAt)}`}
                    </p>
                    <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-line text-gray-800">
                      {c.proposal}
                    </p>
                  </div>
                )}
                {c.outcome && (
                  <div className="rounded-lg bg-accent-soft px-4 py-3 ring-1 ring-highlight/20 ring-inset">
                    <p className="text-xs font-semibold tracking-wide text-highlight-text uppercase">
                      Resolución del comité
                      {c.resolvedBy && ` · ${c.resolvedBy}`}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-line text-gray-800">
                      {c.outcome}
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Relato de la denuncia">
            {readOnly ? (
              <div className="flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-4 text-sm text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                <Icon
                  name="lock"
                  className="mt-0.5 size-4 shrink-0 text-gray-400"
                />
                Contenido reservado. Como auditor revisas estados, plazos y
                trazabilidad, sin acceder al relato ni a la identidad de las
                personas.
              </div>
            ) : (
              <>
                <p className="text-[15px] leading-relaxed whitespace-pre-line text-gray-800">
                  {c.description}
                </p>
                {(c.occurredWhen || c.occurredWhere) && (
                  <dl className="mt-5 grid gap-5 border-t border-line-soft pt-5 sm:grid-cols-2">
                    {c.occurredWhen && (
                      <KeyValue label="Cuándo ocurrió">
                        {c.occurredWhen}
                      </KeyValue>
                    )}
                    {c.occurredWhere && (
                      <KeyValue label="Dónde ocurrió">
                        {c.occurredWhere}
                      </KeyValue>
                    )}
                  </dl>
                )}
              </>
            )}
          </Panel>

          {!readOnly && !c.reporterChannel && (
            <Panel title="Conversación con el denunciante">
              <p className="flex items-start gap-3 text-sm text-gray-600">
                <Icon
                  name="mail"
                  className="mt-0.5 size-4 shrink-0 text-gray-400"
                />
                {c.origin === "dt"
                  ? "Esta denuncia la tramita la Dirección del Trabajo: el contacto con el denunciante es a través de la DT."
                  : "Esta denuncia no tiene clave de seguimiento, por lo que no hay buzón con el denunciante."}
              </p>
            </Panel>
          )}

          {!readOnly && c.reporterChannel && (
            <Panel
              title="Conversación con el denunciante"
              description={
                c.isAnonymous
                  ? "Buzón seguro: el denunciante es anónimo y responde con su clave de seguimiento."
                  : "Buzón seguro: el denunciante responde con su clave de seguimiento."
              }
              counter={data.messages.length}
            >
              <MessageThread
                empty={
                  canMessage
                    ? "Aún no hay mensajes. Escríbele para pedir antecedentes o informarle avances."
                    : "Aún no hay mensajes con el denunciante."
                }
                messages={data.messages.map((m) => ({
                  id: m.id,
                  mine: m.sender === "staff",
                  author: m.author,
                  body: m.body,
                  createdAt: m.createdAt,
                  readAt: m.sender === "staff" ? m.readAt : undefined,
                }))}
              />
              {canMessage && (
                <div className="mt-6 border-t border-line-soft pt-5">
                  <MessageComposer
                    onSend={sendMessage}
                    placeholder="Escribe al denunciante…"
                    hint="El denunciante no ve tu nombre: los mensajes llegan como «Equipo del canal»."
                  />
                </div>
              )}
            </Panel>
          )}

          {((c.reporterChannel && planHas(plan, "evidence")) || data.files.length > 0) && (
            <CaseFilesPanel
              files={data.files}
              canDownload={data.canDownloadFiles}
              basePath={`${apiBase}/cases/${id}/files`}
              token={token}
              isAnonymous={c.isAnonymous}
            />
          )}

          <Panel title="Personas">
            <dl className="grid gap-5 sm:grid-cols-2">
              <KeyValue label="Denunciante">
                {readOnly ? (
                  <span className="font-normal text-gray-500">
                    {c.isAnonymous ? "Anónimo" : "Identificado (reservado)"}
                  </span>
                ) : c.reporter ? (
                  <>
                    {c.reporter.name}
                    {c.reporter.rut && (
                      <span className="block font-normal text-gray-500">
                        RUN {c.reporter.rut}
                      </span>
                    )}
                    {c.reporter.email && (
                      <span className="block font-normal text-gray-500">
                        {c.reporter.email}
                      </span>
                    )}
                    {c.reporter.phone && (
                      <span className="block font-normal text-gray-500">
                        {c.reporter.phone}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-normal text-gray-600">
                    <Icon name="user" className="size-4" />
                    Anónimo
                  </span>
                )}
                {c.reporterRelation && (
                  <span className="block text-xs font-normal text-gray-500">
                    {c.reporterRelation}
                  </span>
                )}
              </KeyValue>
              {c.affected && (
                <KeyValue label="Persona afectada">
                  {c.affected.name}
                  {c.affected.rut && (
                    <span className="block font-normal text-gray-500">
                      RUN {c.affected.rut}
                    </span>
                  )}
                  {c.affected.email && (
                    <span className="block font-normal text-gray-500">
                      {c.affected.email}
                    </span>
                  )}
                  {c.affected.representation && (
                    <span className="block text-xs font-normal text-gray-500">
                      Representación: {c.affected.representation}
                    </span>
                  )}
                </KeyValue>
              )}
              <KeyValue label="Investigador asignado">
                {c.investigator?.name ?? (
                  <span className="font-normal text-gray-500">Sin asignar</span>
                )}
              </KeyValue>
              {c.involved.map((p, i) => (
                <KeyValue key={i} label={p.relation}>
                  {p.name}
                </KeyValue>
              ))}
            </dl>
            {c.involvedUsers.length > 0 && (
              <div className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/15 ring-inset">
                <p className="font-medium">
                  Excluidos por conflicto de interés
                </p>
                <p className="mt-0.5">
                  {c.involvedUsers.map((u) => u.name).join(", ")}. No ven este
                  caso con ningún rol.
                </p>
              </div>
            )}
          </Panel>

          <Panel
            flush
            title="Trazabilidad"
            description="Registro de cada paso del caso. No se puede modificar ni borrar."
          >
            <ol className="relative px-4 py-5 sm:px-6">
              {data.events.map((e, i) => (
                <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < data.events.length - 1 && (
                    <span className="absolute top-7 left-[13px] h-[calc(100%-1.25rem)] w-px bg-line" />
                  )}
                  <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-highlight-text">
                    <Icon
                      name={EVENT_ICONS[e.kind] ?? "activity"}
                      className="size-3.5"
                    />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-medium text-gray-900">
                      {e.action}
                    </p>
                    <p className="text-xs text-gray-500">
                      {e.actor_label} · {formatDate(e.occurred_at, true)}
                    </p>
                    {e.detail && (
                      <p className="mt-1 text-sm whitespace-pre-line text-gray-600">
                        {e.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24">
          <Panel
            title="Acciones"
            description={`Según tu rol: ${ROLES[role].label}`}
          >
            {readOnly ? (
              <p className="flex items-start gap-2 text-sm text-gray-600">
                <Icon
                  name="eye"
                  className="mt-0.5 size-4 shrink-0 text-gray-400"
                />
                Modo solo lectura: el auditor no realiza acciones sobre los
                casos.
              </p>
            ) : (
              <div className="space-y-4">
                {step && (
                  <p
                    className={`rounded-lg px-3.5 py-3 text-sm ring-1 ring-inset ${
                      c.approveBlockedReason && role === "resolver"
                        ? "bg-amber-50 text-amber-900 ring-amber-600/15"
                        : "bg-accent-soft text-gray-800 ring-highlight/20"
                    }`}
                  >
                    {step}
                  </p>
                )}
                {primary.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {primary.map((a) => (
                      <Button
                        key={a}
                        variant="primary"
                        onClick={() => setDialog({ action: a })}
                        className="w-full"
                      >
                        <Icon name={ACTION_UI[a].icon} />
                        {ACTION_UI[a].label}
                      </Button>
                    ))}
                    {c.actions.includes("reject") && (
                      <Button
                        onClick={() => setDialog({ action: "reject" })}
                        className="w-full"
                      >
                        <Icon name={ACTION_UI.reject.icon} />
                        {ACTION_UI.reject.label}
                      </Button>
                    )}
                  </div>
                )}
                {secondary.length > 0 && (
                  <ul className="divide-y divide-line-soft rounded-lg ring-1 ring-line ring-inset">
                    {secondary.map((a) => (
                      <li key={a}>
                        <button
                          onClick={() => setDialog({ action: a })}
                          className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-sm text-gray-800 transition hover:bg-gray-50"
                        >
                          <span className="flex items-center gap-2.5">
                            <Icon
                              name={ACTION_UI[a].icon}
                              className="size-4 text-gray-500"
                            />
                            {ACTION_UI[a].label}
                          </span>
                          <Icon
                            name="chevron"
                            className="size-3.5 text-gray-400"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {c.actions.length === 0 && (
                  <p className="text-sm text-gray-500">
                    {c.status === "closed"
                      ? "La denuncia está cerrada."
                      : "No tienes acciones pendientes en esta etapa."}
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Datos del caso">
            <dl className="grid grid-cols-2 gap-5 xl:grid-cols-1">
              <KeyValue label="Categoría">
                {c.category.name}
                <span className="block text-xs font-normal text-gray-500">
                  {FRAMEWORKS[c.category.framework].label}
                </span>
                {c.topicDetail && (
                  <span className="block text-xs font-normal text-gray-500">
                    «{c.topicDetail}»
                  </span>
                )}
              </KeyValue>
              <KeyValue label="Recibida">
                {formatDate(c.receivedAt, true)}
              </KeyValue>
              <KeyValue label="Plazo">
                <span className={DUE_STYLES[due.tone]}>{due.label}</span>
              </KeyValue>
              {c.closedAt && (
                <KeyValue label="Cerrada">{formatDate(c.closedAt)}</KeyValue>
              )}
              <KeyValue label="Origen">
                {ORIGIN_LABEL[c.origin]}
                {c.originChannel && (
                  <span className="block text-xs font-normal text-gray-500">
                    {CHANNEL_LABEL[c.originChannel]}
                  </span>
                )}
                {c.originDetail && (
                  <span className="block text-xs font-normal text-gray-500">
                    {c.originDetail}
                  </span>
                )}
              </KeyValue>
              {karin && (
                <KeyValue label="Procedimiento">
                  {c.route ? (
                    ROUTE_LABEL[c.route]
                  ) : (
                    <span className="font-normal text-amber-700">
                      Por definir
                    </span>
                  )}
                  {c.reporterRequestsDt && (
                    <span className="block text-xs font-normal text-gray-500">
                      El denunciante pidió que investigue la DT
                    </span>
                  )}
                </KeyValue>
              )}
              {c.offenderRelation && (
                <KeyValue label="Quién realizó la conducta">
                  {OFFENDER_LABEL[c.offenderRelation]}
                  {c.ongoing && (
                    <span className="block text-xs font-normal text-gray-500">
                      {ONGOING_LABEL[c.ongoing]}
                    </span>
                  )}
                  {c.urgentProtection && (
                    <span className="block text-xs font-semibold text-red-700">
                      Pide protección urgente
                    </span>
                  )}
                </KeyValue>
              )}
              {c.companyRelationLabel && (
                <KeyValue label="Empresas involucradas">
                  {c.companyRelationLabel}
                  {c.otherCompany && (
                    <span className="block text-xs font-normal text-gray-500">
                      {c.otherCompany}
                    </span>
                  )}
                </KeyValue>
              )}
            </dl>
          </Panel>

          <ProcedurePanel
            milestones={c.deadlines}
            framework={c.category.framework}
            flowVersion={c.flowVersion}
            onRegister={(key) =>
              setDialog({ action: "milestone", milestoneKey: key })
            }
            onExtend={(key) =>
              setDialog({ action: "extend_deadline", milestoneKey: key })
            }
            onAddTask={
              c.actions.includes("add_task")
                ? () => setDialog({ action: "add_task" })
                : undefined
            }
          />
        </aside>
      </div>

      {dialog && (
        <CaseActionDialog
          action={dialog.action}
          milestoneKey={dialog.milestoneKey}
          detail={c}
          options={data.options}
          onClose={() => setDialog(null)}
          onDone={(summary) => {
            setDialog(null);
            setFlash(summary);
            reload();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </>
  );
}

const PROCEDURE_TITLE: Record<string, string> = {
  ley_karin: "Ley 21.643 (Ley Karin) y DS 21/2024",
  ley_20393: "Ley 20.393 y Ley 21.595 · buenas prácticas ISO 37002",
  ley_21719: "Ley 21.719 de protección de datos personales",
  internal: "Buenas prácticas ISO 37002",
};

/** Hitos del procedimiento legal, con plazo, fundamento y registro. */
const SOURCE_TAG: Record<
  Milestone["source"],
  { label: string; style: string } | null
> = {
  law: null,
  reference: null,
  company: {
    label: "Flujo de la empresa",
    style: "bg-violet-50 text-violet-700 ring-violet-600/20",
  },
  task: {
    label: "Tarea del caso",
    style: "bg-sky-50 text-sky-700 ring-sky-600/20",
  },
};

function ProcedurePanel({
  milestones,
  framework,
  flowVersion,
  onRegister,
  onExtend,
  onAddTask,
}: {
  milestones: Milestone[];
  framework: string;
  flowVersion: number | null;
  onRegister: (key: string) => void;
  onExtend: (key: string) => void;
  onAddTask?: () => void;
}) {
  const flowNote =
    framework === "ley_karin"
      ? null
      : flowVersion === null
        ? "Flujo recomendado de la plataforma."
        : `Flujo de la empresa, versión ${flowVersion}.`;
  return (
    <Panel
      title="Procedimiento y plazos"
      description={
        <>
          {PROCEDURE_TITLE[framework]}
          {flowNote && <span className="block">{flowNote}</span>}
        </>
      }
      actions={
        onAddTask && (
          <button
            onClick={onAddTask}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-highlight-text ring-1 ring-highlight/30 ring-inset transition hover:bg-accent-soft"
          >
            <Icon name="plus" className="size-3" />
            Agregar tarea
          </button>
        )
      }
    >
      <ol className="space-y-5">
        {milestones.map((m) => {
          const late = !m.done && !!m.dueAt && isOverdue(m.dueAt);
          const waiting = !m.done && !m.dueAt;
          return (
            <li key={m.key} className="flex gap-3">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                  m.done
                    ? "bg-emerald-500 text-white"
                    : late
                      ? "bg-red-100 text-red-600"
                      : m.external
                        ? "bg-sky-50 text-sky-600 ring-1 ring-sky-600/20 ring-inset"
                        : "ring-2 ring-gray-300 ring-inset"
                }`}
              >
                {m.done ? (
                  <Icon name="check" className="size-3" />
                ) : late ? (
                  <Icon name="error" className="size-3" />
                ) : m.external ? (
                  <Icon name="clock" className="size-3" />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${waiting ? "text-gray-500" : "text-gray-900"}`}
                >
                  {m.label}
                  {m.optional && (
                    <span className="ml-1.5 text-xs font-normal text-gray-500">
                      (si corresponde)
                    </span>
                  )}
                  {m.required && !m.done && (
                    <span className="ml-1.5 text-xs font-normal text-gray-500">
                      (obligatorio)
                    </span>
                  )}
                </p>
                {(SOURCE_TAG[m.source] || m.owner === "investigator") && (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {SOURCE_TAG[m.source] && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${SOURCE_TAG[m.source]!.style}`}
                      >
                        {SOURCE_TAG[m.source]!.label}
                      </span>
                    )}
                    {m.owner === "investigator" && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                        A cargo del investigador
                      </span>
                    )}
                  </p>
                )}
                <p
                  className={`mt-0.5 text-xs ${late ? "font-medium text-red-700" : "text-gray-500"}`}
                >
                  {m.done
                    ? m.doneAt
                      ? `Cumplido el ${formatDate(m.doneAt)}`
                      : "Cumplido"
                    : m.dueAt
                      ? `${late ? "Venció" : "Vence"} el ${formatDate(m.dueAt)} · ${m.detail}`
                      : m.detail}
                </p>
                {m.result && (
                  <p className="mt-1 text-xs font-medium text-gray-700">
                    {MILESTONE_RESULT_LABEL[m.result] ?? m.result}
                  </p>
                )}
                {m.note && (
                  <p className="mt-1 text-xs whitespace-pre-line text-gray-600">
                    {m.note}
                  </p>
                )}
                {m.extension && (
                  <p className="mt-1 text-xs text-amber-800">
                    Plazo extendido
                    {m.extension.previousDueAt &&
                      ` (antes: ${formatDate(m.extension.previousDueAt)})`}
                    . Motivo: {m.extension.reason}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-gray-400">
                  {m.basis}
                  {m.legal ? " · plazo legal" : " · no es plazo legal"}
                </p>
                {(m.canRegister || m.canExtend) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.canRegister && (
                      <button
                        onClick={() => onRegister(m.key)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-highlight-text ring-1 ring-highlight/30 ring-inset transition hover:bg-accent-soft"
                      >
                        <Icon name="check" className="size-3" />
                        {m.external ? "Registrar respuesta" : "Registrar"}
                      </button>
                    )}
                    {m.canExtend && (
                      <button
                        onClick={() => onExtend(m.key)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-gray-600 ring-1 ring-line ring-inset transition hover:bg-gray-50"
                      >
                        <Icon name="clock" className="size-3" />
                        Extender plazo
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
