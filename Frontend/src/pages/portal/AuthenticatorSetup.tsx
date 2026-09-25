import { type FormEvent, useState } from "react";
import { Alert, Button, Field, Icon } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import type { ReporterView } from "../../lib/portal";

interface Setup {
  code: string;
  secret: string;
  qrDataUrl: string;
}

/**
 * Asocia una app de autenticación (Google Authenticator, Microsoft Authenticator, etc.) a la denuncia, como segunda
 * forma de entrar al seguimiento: código de la denuncia + código de 6 dígitos de la app.
 */
export function AuthenticatorSetup({
  apiBase,
  session,
  caseCode,
  onEnabled,
}: {
  apiBase: string;
  session: string;
  caseCode: string;
  onEnabled?: (view: ReporterView) => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api<Setup>(`${apiBase}/track/authenticator/setup`, { method: "POST", body: { session } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const view = await api<ReporterView>(`${apiBase}/track/authenticator/confirm`, { method: "POST", body: { session, otp } });
      setDone(true);
      onEnabled?.(view);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields ? Object.values(err.fields).join(". ") : err.message) : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3.5 text-left text-sm text-emerald-900 ring-1 ring-emerald-600/15 ring-inset">
        <Icon name="success" className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong>App asociada.</strong> Para entrar al seguimiento usa el código de la denuncia{" "}
          <span className="font-mono font-semibold">{caseCode}</span> y el código de 6 dígitos que muestre la app.
        </span>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="text-left">
        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="flex flex-col gap-4 rounded-xl border border-line px-4 py-4 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-highlight-text">
            <Icon name="phone" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold text-gray-900">Agregar a tu app de autenticación (opcional)</span>
            <span className="mt-0.5 block text-gray-500">
              Una segunda forma de entrar, por si pierdes la clave: con el código de la denuncia y el de tu app, igual que al
              iniciar sesión en otros servicios.
            </span>
          </span>
          <Button type="button" onClick={start} loading={busy} className="w-full shrink-0 sm:w-auto">
            Activar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="rounded-xl border border-line px-4 py-5 text-left sm:px-6">
      <p className="text-sm font-semibold text-gray-900">Escanea este código con tu app de autenticación</p>
      <p className="mt-1 text-sm text-gray-500">
        Google Authenticator, Microsoft Authenticator u otra. Aparecerá como «Seguimiento: {setup.code}», sin el nombre de la
        empresa; puedes cambiarle el nombre en la app.
      </p>
      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <img src={setup.qrDataUrl} alt="Código QR para la app de autenticación" className="size-44 rounded-lg ring-1 ring-line" />
        <div className="w-full min-w-0 space-y-4">
          <div>
            <p className="text-xs text-gray-500">¿No puedes escanear? Ingresa esta clave en la app:</p>
            <p className="mt-1 rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm break-all text-gray-900 ring-1 ring-gray-200/70 ring-inset">
              {setup.secret.match(/.{1,4}/g)!.join(" ")}
            </p>
          </div>
          {error && <Alert>{error}</Alert>}
          <Field
            label="Código de 6 dígitos que muestra la app"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            mono
          />
          <Button type="submit" variant="primary" loading={busy} disabled={otp.length !== 6} className="w-full">
            Confirmar
          </Button>
        </div>
      </div>
    </form>
  );
}
