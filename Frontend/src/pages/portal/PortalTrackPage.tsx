import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { MessageComposer, MessageThread } from "../../components/MessageThread";
import { Alert, Button, Field, Icon } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { PUBLIC_STEPS, type ReporterView, usePortal } from "../../lib/portal";
import { formatDate } from "../../lib/ui-helpers";
import { AuthenticatorSetup } from "./AuthenticatorSetup";
import { ReporterFiles } from "./ReporterFiles";

type Method = "key" | "app";

/**
 * Seguimiento del denunciante. Se entra con la clave de seguimiento o con el código de la denuncia + el código de la
 * app de autenticación. Nada de esto va en la URL ni se guarda en el navegador: solo una sesión de 30 minutos en
 * memoria mientras la página está abierta.
 */
export function PortalTrackPage() {
  const { apiBase, basePath } = usePortal();
  const [method, setMethod] = useState<Method>("key");
  const [key, setKey] = useState("");
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState("");
  const [view, setView] = useState<ReporterView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function open(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = method === "key" ? { key } : { code: code.trim().toUpperCase(), otp };
      setView(await api<ReporterView>(`${apiBase}/track`, { method: "POST", body }));
      setOtp("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.fields
            ? Object.values(err.fields).join(". ")
            : err.message
          : "Error inesperado",
      );
    } finally {
      setBusy(false);
    }
  }

  // Si la sesión expiró, vuelve al ingreso con un aviso.
  function expired(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      setView(null);
      setError("Tu sesión expiró. Vuelve a ingresar.");
      return true;
    }
    return false;
  }

  async function send(body: string) {
    try {
      setView(await api<ReporterView>(`${apiBase}/track/messages`, { method: "POST", body: { session: view!.session, body } }));
    } catch (err) {
      if (!expired(err)) throw err;
    }
  }

  async function refresh() {
    try {
      setView(await api<ReporterView>(`${apiBase}/track/view`, { method: "POST", body: { session: view!.session } }));
    } catch (err) {
      expired(err);
    }
  }

  async function removeApp() {
    try {
      setView(await api<ReporterView>(`${apiBase}/track/authenticator/remove`, { method: "POST", body: { session: view!.session } }));
      setConfirmRemove(false);
    } catch (err) {
      expired(err);
    }
  }

  function exit() {
    setView(null);
    setKey("");
    setCode("");
    setOtp("");
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-lg">
        <Link to={basePath} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <Icon name="arrowLeft" className="size-3.5" />
          Volver
        </Link>
        <form onSubmit={open} className="mt-3 rounded-2xl border border-line bg-white px-5 py-7 shadow-card sm:px-8 sm:py-8">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-highlight-text">
            <Icon name="key" className="size-5" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-gray-900">Seguir mi denuncia</h1>
          <p className="mt-1.5 text-sm text-gray-500">Elige cómo quieres ingresar.</p>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist">
            {(
              [
                ["key", "Clave de seguimiento"],
                ["app", "App de autenticación"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={method === m}
                onClick={() => {
                  setMethod(m);
                  setError(null);
                }}
                className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
                  method === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-5">
            {error && <Alert>{error}</Alert>}
            {method === "key" ? (
              <Field
                label="Clave de seguimiento"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                mono
                required
              />
            ) : (
              <>
                <Field
                  label="Código de la denuncia"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="DEN-2026-0001"
                  autoComplete="off"
                  mono
                  required
                  hint="Aparece en tu app como «Seguimiento: DEN-…»."
                />
                <Field
                  label="Código de 6 dígitos de la app"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  mono
                  required
                />
              </>
            )}
            <Button type="submit" variant="primary" loading={busy} className="h-11 w-full">
              Ver mi denuncia
            </Button>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-gray-500">
            {method === "key"
              ? "¿Perdiste tu clave? Si asociaste una app de autenticación, ingresa con ella. Si no, por tu privacidad no podemos recuperarla: puedes hacer una nueva denuncia y mencionar el código de la anterior."
              : "Solo funciona si asociaste la app al enviar tu denuncia o desde el seguimiento. Tras 5 intentos fallidos se bloquea por 15 minutos; la clave de seguimiento sigue funcionando."}
          </p>
        </form>
      </div>
    );
  }

  const current = PUBLIC_STEPS.findIndex((s) => s.key === view.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm text-gray-500">{view.code}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{view.subject}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {view.category} · Enviada el {formatDate(view.receivedAt)}
          </p>
        </div>
        <Button onClick={exit}>
          <Icon name="logout" />
          Salir
        </Button>
      </div>

      <section className="rounded-2xl border border-line bg-white px-5 py-6 shadow-card sm:px-8">
        <p className="text-sm text-gray-500">Estado</p>
        <p className="mt-1 text-xl font-semibold text-gray-900">{view.statusLabel}</p>
        <p className="mt-1 text-sm text-gray-600">{view.statusDescription}</p>
        <ol className="mt-6 grid grid-cols-4 gap-2">
          {PUBLIC_STEPS.map((s, i) => (
            <li key={s.key}>
              <span className={`block h-1.5 rounded-full ${i < current || view.status === "closed" ? "bg-emerald-500" : i === current ? "bg-highlight" : "bg-gray-200"}`} />
              <span className={`mt-2 block text-xs sm:text-sm ${i === current ? "font-semibold text-gray-900" : "text-gray-500"}`}>{s.label}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-line bg-white shadow-card">
        <header className="flex items-center justify-between gap-4 border-b border-line-soft px-5 py-4 sm:px-8">
          <span>
            <span className="block text-base font-semibold text-gray-900">Mensajes</span>
            <span className="block text-sm text-gray-500">Conversación segura con el equipo del canal.</span>
          </span>
          <Button variant="link" onClick={refresh} className="h-9 px-2" aria-label="Actualizar">
            <Icon name="refresh" />
          </Button>
        </header>
        <div className="px-5 py-6 sm:px-8">
          <MessageThread
            empty="Aún no hay mensajes. Si el equipo necesita más antecedentes te escribirá aquí; vuelve a revisar cada cierto tiempo."
            messages={view.messages.map((m) => ({
              id: m.id,
              mine: m.sender === "reporter",
              author: m.sender === "reporter" ? "Tú" : "Equipo del canal",
              body: m.body,
              createdAt: m.createdAt,
              readAt: m.sender === "reporter" ? m.readAt : undefined,
            }))}
          />
          {view.canReply ? (
            <div className="mt-6 border-t border-line-soft pt-5">
              <MessageComposer
                onSend={send}
                placeholder="Escribe al equipo del canal…"
                hint={view.isAnonymous ? "Sigues siendo anónimo: no incluyas datos que te identifiquen si no quieres." : undefined}
              />
            </div>
          ) : (
            <p className="mt-6 border-t border-line-soft pt-5 text-sm text-gray-500">La denuncia está cerrada y ya no recibe mensajes.</p>
          )}
        </div>
      </section>

      {(view.evidenceEnabled || view.files.length > 0) && (
        <ReporterFiles apiBase={apiBase} view={view} onUpdated={setView} onExpired={expired} />
      )}

      {(view.authenticatorEnabled || view.authenticatorAvailable) && (
        <section className="rounded-2xl border border-line bg-white px-5 py-5 shadow-card sm:px-8">
          {view.authenticatorEnabled ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-start gap-3 text-sm">
                <Icon name="success" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  <span className="block font-medium text-gray-900">App de autenticación asociada</span>
                  <span className="block text-gray-500">Puedes entrar con el código {view.code} y el de tu app.</span>
                </span>
              </span>
              {confirmRemove ? (
                <span className="flex gap-2">
                  <Button onClick={() => setConfirmRemove(false)}>Cancelar</Button>
                  <Button variant="danger" onClick={removeApp}>
                    Quitar
                  </Button>
                </span>
              ) : (
                <Button onClick={() => setConfirmRemove(true)} className="w-full sm:w-auto">
                  Quitar app
                </Button>
              )}
            </div>
          ) : (
            <AuthenticatorSetup apiBase={apiBase} session={view.session} caseCode={view.code} onEnabled={setView} />
          )}
        </section>
      )}
    </div>
  );
}
