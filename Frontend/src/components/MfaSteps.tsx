import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import type { MfaSetupResponse } from "../lib/types";
import { Alert, Button, Icon, Spinner } from "./ui";

/* ---------------------------------------------------------------- Campo del código */

function CodeInput({
  value,
  onChange,
  onComplete,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
        onChange(digits);
        if (digits.length === 6) onComplete(digits);
      }}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      placeholder="000000"
      aria-label="Código de 6 dígitos"
      className="block h-14 w-full rounded-lg border border-gray-300 bg-white text-center font-mono text-[26px] tracking-[0.45em] text-gray-900 shadow-sm outline-none transition placeholder:text-gray-300 focus:border-highlight focus:ring-4 focus:ring-highlight/20"
    />
  );
}

/** Formatea la clave en grupos de 4 para que sea fácil de transcribir. */
const groupKey = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: el usuario puede seleccionar el texto manualmente.
    }
  };
  return { copied, copy };
}

/* ---------------------------------------------------------------- Configuración (primera vez) */

export function MfaSetupStep({
  apiBase,
  mfaToken,
  onVerify,
  onExpired,
}: {
  apiBase: string;
  mfaToken: string;
  onVerify: (code: string) => Promise<void>;
  onExpired: (message: string) => void;
}) {
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    api<MfaSetupResponse>(`${apiBase}/auth/mfa/setup`, { method: "POST", body: { mfaToken } })
      .then(setSetup)
      .catch((err) => onExpired(err instanceof ApiError ? err.message : "Error inesperado"));
  }, [apiBase, mfaToken, onExpired]);

  async function submit(value: string) {
    if (value.length !== 6 || loading) return;
    setError(null);
    setLoading(true);
    try {
      await onVerify(value);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setCode("");
      setLoading(false);
    }
  }

  if (!setup) {
    return (
      <div className="flex justify-center py-16 text-highlight">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(code);
      }}
      className="space-y-7"
    >
      <Step n={1} title="Instala una app de autenticación">
        Google Authenticator, Microsoft Authenticator o Authy, desde la tienda de tu teléfono.
      </Step>

      <Step n={2} title="Escanea este código QR">
        <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <img
            src={setup.qrDataUrl}
            alt="Código QR para la app de autenticación"
            className="size-40 shrink-0 rounded-lg border border-line bg-white p-2"
          />
          <div className="text-sm text-gray-500">
            {showKey ? (
              <div>
                <p>Ingresa esta clave en la app:</p>
                <p className="mt-2 font-mono text-[13px] leading-relaxed font-medium break-all text-gray-900">
                  {groupKey(setup.secret)}
                </p>
                <button
                  type="button"
                  onClick={() => copy(setup.secret)}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
                >
                  <Icon name="copy" className="size-3.5" />
                  {copied ? "Copiada" : "Copiar clave"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowKey(true)}
                className="text-sm font-medium text-accent hover:text-accent-hover"
              >
                ¿No puedes escanearlo? Ingresa la clave manualmente
              </button>
            )}
          </div>
        </div>
      </Step>

      <Step n={3} title="Ingresa el código de 6 dígitos">
        <div className="mt-3 space-y-4">
          {error && <Alert>{error}</Alert>}
          <CodeInput value={code} onChange={setCode} onComplete={submit} />
          <Button type="submit" variant="primary" loading={loading} disabled={code.length !== 6} className="h-11 w-full">
            Activar y continuar
          </Button>
        </div>
      </Step>
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-highlight-text">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <div className="mt-1 text-sm text-gray-500">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Verificación (logins siguientes) */

export function MfaVerifyStep({ onVerify }: { onVerify: (code: string) => Promise<void> }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    if (loading || (!useRecovery && value.length !== 6) || (useRecovery && value.trim().length < 10)) return;
    setError(null);
    setLoading(true);
    try {
      await onVerify(value.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setCode("");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(code);
      }}
      className="space-y-5"
    >
      {error && <Alert>{error}</Alert>}

      {useRecovery ? (
        <label className="block">
          <span className="block text-sm font-medium text-gray-800">Código de recuperación</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="xxxxx-xxxxx"
            className="mt-2 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3.5 font-mono text-base tracking-wider text-gray-900 shadow-sm outline-none transition placeholder:text-gray-300 focus:border-highlight focus:ring-4 focus:ring-highlight/20"
          />
          <span className="mt-1.5 block text-sm text-gray-500">Cada código de recuperación se puede usar una sola vez.</span>
        </label>
      ) : (
        <CodeInput value={code} onChange={setCode} onComplete={submit} />
      )}

      <Button type="submit" variant="primary" loading={loading} className="h-11 w-full text-[15px]">
        Verificar
      </Button>

      <button
        type="button"
        onClick={() => {
          setUseRecovery((v) => !v);
          setCode("");
          setError(null);
        }}
        className="flex w-full items-center justify-center gap-2 text-sm font-medium text-accent hover:text-accent-hover"
      >
        <Icon name={useRecovery ? "phone" : "key"} className="size-4" />
        {useRecovery ? "Usar el código de la app de autenticación" : "¿Sin acceso a tu teléfono? Usa un código de recuperación"}
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------- Códigos de recuperación */

export function RecoveryCodesStep({
  codes,
  account,
  onContinue,
}: {
  codes: string[];
  account: string;
  onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const { copied, copy } = useCopy();
  const text = codes.join("\n");

  function download() {
    const content = [
      "Canal de Denuncias — Códigos de recuperación",
      `Cuenta: ${account}`,
      `Generados: ${new Date().toLocaleString("es-CL")}`,
      "",
      "Cada código se puede usar una sola vez si pierdes acceso a tu app de autenticación.",
      "",
      ...codes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "codigos-recuperacion-canal-denuncias.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Alert type="info">
        Si pierdes tu teléfono, estos códigos son la única forma de ingresar sin ayuda de un administrador. Se
        muestran <strong>una sola vez</strong>.
      </Alert>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg bg-gray-50 px-6 py-5 ring-1 ring-gray-200/70 ring-inset">
        {codes.map((c) => (
          <span key={c} className="font-mono text-[15px] tracking-wide text-gray-900">
            {c}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button type="button" onClick={() => copy(text)}>
          <Icon name="copy" />
          {copied ? "Copiados" : "Copiar"}
        </Button>
        <Button type="button" onClick={download}>
          <Icon name="download" />
          Descargar
        </Button>
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 size-4 rounded border-gray-300 accent-brand-navy"
        />
        Guardé mis códigos de recuperación en un lugar seguro.
      </label>

      <Button type="button" variant="primary" disabled={!saved} onClick={onContinue} className="h-11 w-full text-[15px]">
        Continuar
      </Button>
    </div>
  );
}
