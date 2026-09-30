import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import { formatDate } from "../lib/ui-helpers";
import { ConfirmModal } from "./dialogs";
import { Alert, Button, Field, Icon, Panel, Select, Toggle } from "./ui";

type Security = "starttls" | "tls" | "none";

interface MailView {
  host: string;
  port: number;
  security: Security;
  username: string | null;
  passwordSet: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  verifyTls: boolean;
  updatedAt: string;
  lastTest: { at: string; ok: boolean; error?: string; to?: string } | null;
  lastFailure: { at: string; error: string } | null;
}

interface MailState {
  mail: MailView | null;
  /** Hay un SMTP de respaldo (plataforma o servidor) si se quita esta configuración. */
  fallback: boolean;
}

interface Preset {
  id: string;
  label: string;
  host: string;
  port: number;
  security: Security;
  username?: string;
  hint: string;
}

/** Proveedores habituales: rellenan servidor, puerto y seguridad. Cualquier otro SMTP se configura en «Otro servidor». */
const PRESETS: Preset[] = [
  {
    id: "microsoft365",
    label: "Microsoft 365 / Exchange Online",
    host: "smtp.office365.com",
    port: 587,
    security: "starttls",
    hint: "Usuario: el correo completo del buzón. El administrador de Microsoft 365 debe habilitar «SMTP autenticado» para ese buzón. El remitente debe ser ese buzón o uno con permiso «Enviar como».",
  },
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 587,
    security: "starttls",
    hint: "Usuario: la cuenta completa. Contraseña: una «contraseña de aplicación» (myaccount.google.com/apppasswords), no la contraseña normal. El remitente debe ser la misma cuenta o un alias verificado.",
  },
  {
    id: "google-relay",
    label: "Google Workspace (relay SMTP)",
    host: "smtp-relay.gmail.com",
    port: 587,
    security: "starttls",
    hint: "Requiere configurar el servicio de relay SMTP en la consola de Google Workspace (por IP o con autenticación).",
  },
  {
    id: "outlook",
    label: "Outlook.com / Hotmail",
    host: "smtp-mail.outlook.com",
    port: 587,
    security: "starttls",
    hint: "Usuario: la cuenta completa de Outlook o Hotmail. El remitente debe ser esa misma cuenta.",
  },
  {
    id: "ses",
    label: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    security: "starttls",
    hint: "Cambia la región del servidor (p. ej. email-smtp.sa-east-1.amazonaws.com). Usa las credenciales SMTP de SES, no las de IAM. El remitente o su dominio deben estar verificados en SES.",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    security: "starttls",
    username: "apikey",
    hint: "Usuario: literalmente «apikey». Contraseña: tu API key de SendGrid. El remitente debe estar verificado.",
  },
  {
    id: "brevo",
    label: "Brevo (Sendinblue)",
    host: "smtp-relay.brevo.com",
    port: 587,
    security: "starttls",
    hint: "Usuario y clave SMTP: en Brevo → SMTP y API. El remitente debe estar verificado.",
  },
  {
    id: "mailgun",
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    security: "starttls",
    hint: "Usuario y contraseña SMTP del dominio en Mailgun (para la región EU: smtp.eu.mailgun.org).",
  },
  {
    id: "postmark",
    label: "Postmark",
    host: "smtp.postmarkapp.com",
    port: 587,
    security: "starttls",
    hint: "Usuario y contraseña: el Server API Token. El remitente debe estar verificado.",
  },
  {
    id: "resend",
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    security: "tls",
    username: "resend",
    hint: "Usuario: «resend». Contraseña: tu API key. El dominio del remitente debe estar verificado.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: 465,
    security: "tls",
    hint: "Usuario: la cuenta completa (en Europa: smtp.zoho.eu). Si tienes 2FA en Zoho, usa una contraseña de aplicación.",
  },
  {
    id: "custom",
    label: "Otro servidor SMTP (Exchange local, hosting, etc.)",
    host: "",
    port: 587,
    security: "starttls",
    hint: "Pide a tu área de TI o a tu proveedor de correo: servidor, puerto, tipo de seguridad y una cuenta para enviar.",
  },
];

const SECURITY_LABEL: Record<Security, string> = {
  starttls: "STARTTLS (normalmente puerto 587)",
  tls: "SSL/TLS (normalmente puerto 465)",
  none: "Sin cifrado (solo relays internos)",
};
const DEFAULT_PORT: Record<Security, number> = {
  starttls: 587,
  tls: 465,
  none: 25,
};

interface FormState {
  preset: string;
  host: string;
  port: string;
  security: Security;
  auth: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  verifyTls: boolean;
}

const presetFor = (host: string) =>
  PRESETS.find((p) => p.id !== "custom" && p.host === host)?.id ?? "custom";

function formFrom(mail: MailView | null, defaultFromName: string): FormState {
  if (!mail) {
    return {
      preset: "microsoft365",
      host: PRESETS[0]!.host,
      port: String(PRESETS[0]!.port),
      security: PRESETS[0]!.security,
      auth: true,
      username: "",
      password: "",
      fromName: defaultFromName,
      fromEmail: "",
      replyTo: "",
      verifyTls: true,
    };
  }
  return {
    preset: presetFor(mail.host),
    host: mail.host,
    port: String(mail.port),
    security: mail.security,
    auth: !!mail.username,
    username: mail.username ?? "",
    password: "",
    fromName: mail.fromName,
    fromEmail: mail.fromEmail,
    replyTo: mail.replyTo ?? "",
    verifyTls: mail.verifyTls,
  };
}

/**
 * Configuración del correo saliente (SMTP). La usan la consola de la plataforma (SMTP por defecto)
 * y cada empresa (SMTP propio, opcional).
 */
export function MailSettings({
  endpoint,
  token,
  onUnauthorized,
  scope,
  defaultFromName,
  defaultTestTo,
}: {
  /** "/admin/mail" o "/t/{slug}/console/mail". */
  endpoint: string;
  token: string;
  onUnauthorized: () => void;
  scope: "platform" | "tenant";
  defaultFromName: string;
  defaultTestTo: string;
}) {
  const [state, setState] = useState<MailState | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    formFrom(null, defaultFromName),
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState(defaultTestTo);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(
    (next: MailState) => {
      setState(next);
      setForm(formFrom(next.mail, defaultFromName));
    },
    [defaultFromName],
  );

  useEffect(() => {
    api<MailState>(endpoint, { token })
      .then(load)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401)
          return onUnauthorized();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [endpoint, token, onUnauthorized, load]);

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      setFields((f) => ({ ...f, [key]: "" }));
      setTestResult(null);
    };

  function pickPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    setForm((f) => ({
      ...f,
      preset: id,
      host: p.host || (f.preset === "custom" ? f.host : ""),
      port: String(p.port),
      security: p.security,
      auth: true,
      username:
        p.username ??
        (PRESETS.some((x) => x.username === f.username) ? "" : f.username),
    }));
    setFields({});
    setTestResult(null);
  }

  function pickSecurity(security: Security) {
    // Si el puerto era el típico del tipo anterior, se cambia al típico del nuevo.
    setForm((f) => ({
      ...f,
      security,
      port: Object.values(DEFAULT_PORT).map(String).includes(f.port)
        ? String(DEFAULT_PORT[security])
        : f.port,
      auth: security === "none" ? false : f.auth,
    }));
    setTestResult(null);
  }

  const payload = () => ({
    host: form.host.trim(),
    port: Number(form.port),
    security: form.security,
    username: form.auth ? form.username.trim() || null : null,
    password: form.auth && form.password ? form.password : undefined,
    fromName: form.fromName.trim(),
    fromEmail: form.fromEmail.trim(),
    replyTo: form.replyTo.trim() || null,
    verifyTls: form.verifyTls,
  });

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) return onUnauthorized();
    const f = err instanceof ApiError ? (err.fields ?? {}) : {};
    // Los campos anidados de la prueba vienen como «config.host».
    setFields(
      Object.fromEntries(
        Object.entries(f).map(([k, v]) => [k.replace(/^config\./, ""), v]),
      ),
    );
    setError(err instanceof ApiError ? err.message : "Error inesperado");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFlash(null);
    setFields({});
    try {
      load(
        await api<MailState>(endpoint, {
          method: "PUT",
          token,
          body: payload(),
        }),
      );
      setFlash(
        "Configuración guardada. Envía un correo de prueba para confirmar que funciona.",
      );
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setError(null);
    setFlash(null);
    setFields({});
    setTestResult(null);
    try {
      const res = await api<
        MailState & { result: { ok: boolean; error?: string } }
      >(`${endpoint}/test`, {
        method: "POST",
        token,
        body: { config: payload(), to: testTo },
      });
      setState({ mail: res.mail, fallback: res.fallback });
      setTestResult(res.result);
    } catch (err) {
      handleError(err);
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    load(await api<MailState>(endpoint, { method: "DELETE", token }));
    setConfirmRemove(false);
    setTestResult(null);
    setFlash(
      scope === "tenant"
        ? "Se quitó el SMTP propio. Los correos se enviarán con el de la plataforma."
        : "Se quitó el SMTP de la plataforma. Se usará el configurado en el servidor (.env), si existe.",
    );
  }

  if (!state)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="py-16 text-center text-sm text-gray-500">Cargando…</p>
    );

  const preset = PRESETS.find((p) => p.id === form.preset)!;
  const mail = state.mail;
  const dirty =
    JSON.stringify(formFrom(mail, defaultFromName)) !== JSON.stringify(form);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <form onSubmit={save} className="min-w-0 space-y-6">
        {error && <Alert>{error}</Alert>}
        {flash && <Alert type="success">{flash}</Alert>}

        <Panel
          title="Servidor"
          description="Elige tu proveedor para completar los datos, o «Otro servidor» para cualquier SMTP."
        >
          <div className="space-y-5">
            <label className="block">
              <span className="block text-sm font-medium text-gray-800">
                Proveedor
              </span>
              <div className="mt-2">
                <Select
                  value={form.preset}
                  onChange={pickPreset}
                  aria-label="Proveedor"
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
            </label>
            <div className="flex items-start gap-3 rounded-lg bg-accent-soft px-4 py-3 text-sm leading-relaxed text-gray-700">
              <Icon
                name="error"
                className="mt-0.5 size-4 shrink-0 text-highlight-text"
              />
              {preset.hint}
            </div>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field
                label="Servidor SMTP"
                value={form.host}
                onChange={(e) => set("host")(e.target.value)}
                placeholder="smtp.tuempresa.com"
                required
                mono
                error={fields.host}
              />
              <Field
                label="Puerto"
                inputMode="numeric"
                value={form.port}
                onChange={(e) =>
                  set("port")(e.target.value.replace(/\D/g, "").slice(0, 5))
                }
                required
                mono
                error={fields.port}
              />
            </div>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800">
                Seguridad
              </span>
              <div className="mt-2">
                <Select
                  value={form.security}
                  onChange={(v) => pickSecurity(v as Security)}
                  aria-label="Seguridad"
                >
                  {(Object.keys(SECURITY_LABEL) as Security[]).map((s) => (
                    <option key={s} value={s}>
                      {SECURITY_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>
              {fields.security && (
                <span className="mt-1.5 block text-sm text-red-600">
                  {fields.security}
                </span>
              )}
            </label>
          </div>
        </Panel>

        <Panel title="Autenticación">
          <div className="space-y-5">
            <Toggle
              checked={form.auth}
              onChange={set("auth")}
              disabled={form.security === "none"}
              label="El servidor pide usuario y contraseña"
              description="Desactívalo solo para un relay interno que autoriza por dirección IP."
            />
            {form.auth && (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Usuario"
                  value={form.username}
                  onChange={(e) => set("username")(e.target.value)}
                  autoComplete="off"
                  required
                  error={fields.username}
                />
                <Field
                  label="Contraseña"
                  type="password"
                  value={form.password}
                  onChange={(e) => set("password")(e.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    mail?.passwordSet
                      ? "Guardada: déjala vacía para mantenerla"
                      : ""
                  }
                  required={!mail?.passwordSet}
                  error={fields.password}
                  hint={
                    mail?.passwordSet
                      ? "Se guarda cifrada y nunca se vuelve a mostrar."
                      : "Se guarda cifrada."
                  }
                />
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="Remitente"
          description="Cómo aparecerán los correos en la bandeja de quien los recibe."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Nombre"
              value={form.fromName}
              onChange={(e) => set("fromName")(e.target.value)}
              required
              maxLength={120}
              error={fields.fromName}
            />
            <Field
              label="Correo"
              type="email"
              value={form.fromEmail}
              onChange={(e) => set("fromEmail")(e.target.value)}
              placeholder="no-responder@tuempresa.com"
              required
              error={fields.fromEmail}
              hint="Debe estar autorizado en el servidor SMTP."
            />
            <div className="sm:col-span-2">
              <Field
                label="Responder a (opcional)"
                type="email"
                value={form.replyTo}
                onChange={(e) => set("replyTo")(e.target.value)}
                placeholder="soporte@tuempresa.com"
                error={fields.replyTo}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Avanzado">
          <Toggle
            checked={form.verifyTls}
            onChange={set("verifyTls")}
            label="Verificar el certificado del servidor"
            description="Recomendado. Desactívalo solo para un servidor interno con certificado propio de tu empresa."
          />
        </Panel>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!dirty && !!mail}
          >
            Guardar configuración
          </Button>
          {mail && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmRemove(true)}
            >
              Quitar configuración
            </Button>
          )}
        </div>
      </form>

      <aside className="space-y-6 xl:sticky xl:top-24">
        <Panel title="Estado">
          <StatusBox state={state} scope={scope} />
        </Panel>
        <Panel
          title="Probar"
          description="Envía un correo real con los datos del formulario, aunque todavía no los guardes."
        >
          <div className="space-y-4">
            <Field
              label="Enviar a"
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button
              type="button"
              onClick={test}
              loading={testing}
              disabled={!testTo || !form.host || !form.fromEmail}
              className="w-full"
            >
              <Icon name="mail" />
              Enviar correo de prueba
            </Button>
            {testResult &&
              (testResult.ok ? (
                <Alert type="success">
                  Correo enviado a {testTo}. Revisa la bandeja de entrada (y la
                  de spam).
                </Alert>
              ) : (
                <Alert>{testResult.error}</Alert>
              ))}
          </div>
        </Panel>
      </aside>

      {confirmRemove && (
        <ConfirmModal
          title="¿Quitar la configuración de correo?"
          confirmLabel="Quitar"
          danger
          onConfirm={remove}
          onClose={() => setConfirmRemove(false)}
        >
          <p>
            {scope === "tenant"
              ? "Los correos de tu empresa se enviarán con el correo de la plataforma BeeHives."
              : state.fallback
                ? "Los correos se enviarán con el SMTP configurado en el servidor (.env)."
                : "No hay otro SMTP configurado: los correos (como la recuperación de contraseña) no se enviarán."}
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

function StatusBox({
  state,
  scope,
}: {
  state: MailState;
  scope: "platform" | "tenant";
}) {
  const { mail, fallback } = state;
  if (!mail) {
    return (
      <div className="space-y-3 text-sm leading-relaxed text-gray-600">
        <p className="flex items-center gap-2 font-semibold text-gray-900">
          <span
            className={`size-2 rounded-full ${fallback ? "bg-sky-500" : "bg-amber-500"}`}
          />
          {scope === "tenant"
            ? "Usando el correo de la plataforma"
            : fallback
              ? "Usando el SMTP del servidor (.env)"
              : "Sin correo configurado"}
        </p>
        <p>
          {scope === "tenant"
            ? fallback
              ? "Tus correos salen con el remitente de BeeHives, con el nombre de tu empresa. Configura tu propio SMTP para que salgan desde tu dominio."
              : "La plataforma todavía no tiene un correo configurado: los correos no se enviarán hasta que configures uno aquí o lo haga BeeHives."
            : fallback
              ? "Configura aquí el SMTP por defecto de todas las empresas."
              : "Los correos (como la recuperación de contraseña) no se envían. Configura un SMTP."}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-600">
      <p className="flex items-center gap-2 font-semibold text-gray-900">
        <span
          className={`size-2 rounded-full ${mail.lastFailure ? "bg-red-500" : mail.lastTest?.ok ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        {scope === "tenant"
          ? "Usando tu propio SMTP"
          : "SMTP de la plataforma activo"}
      </p>
      <p className="font-mono text-xs break-all text-gray-500">
        {mail.host}:{mail.port} · {mail.fromEmail}
      </p>
      {mail.lastTest ? (
        <p>
          Última prueba ({formatDate(mail.lastTest.at, true)}):{" "}
          {mail.lastTest.ok ? (
            <span className="font-medium text-emerald-700">correcta</span>
          ) : (
            <span className="font-medium text-red-700">
              falló — {mail.lastTest.error}
            </span>
          )}
        </p>
      ) : (
        <p className="text-amber-700">
          Todavía no se ha probado esta configuración.
        </p>
      )}
      {mail.lastFailure && (
        <Alert>
          El {formatDate(mail.lastFailure.at, true)} falló un envío y se usó el
          correo de respaldo: {mail.lastFailure.error}
        </Alert>
      )}
      {scope === "tenant" && (
        <p className="text-xs text-gray-500">
          Si tu SMTP falla, los correos se envían igual con el de la plataforma.
        </p>
      )}
    </div>
  );
}
