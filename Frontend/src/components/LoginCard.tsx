import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ApiError, api } from "../lib/api";
import { ROLES, ROLE_ORDER, type TenantRole } from "../lib/roles";
import type { LoginStartResponse, MfaVerifyResponse } from "../lib/types";
import { Brand, BrandLogo } from "./Brand";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { MfaSetupStep, MfaVerifyStep, RecoveryCodesStep } from "./MfaSteps";
import { Alert, Button, Field, Icon } from "./ui";

interface Props {
  /** Etiqueta bajo la marca (p. ej. "Consola de administración" o el nombre de la empresa). */
  caption: string;
  /** Título del panel de marca. */
  headline: ReactNode;
  /** Texto del panel de marca. */
  tagline: string;
  /** Texto sobre el formulario de contraseña. */
  description: string;
  /** Prefijo de la API de este ámbito: "/admin" o "/t/{slug}". */
  apiBase: string;
  /** Se llama con el token de sesión cuando el usuario completó contraseña + 2FA. */
  onAuthenticated: (token: string) => void;
  /** Contenido extra bajo el formulario de ingreso (p. ej. enlace al portal del denunciante). */
  footer?: ReactNode;
  /** Marca de la empresa: logo sobre el formulario y colores. */
  orgLogoUrl?: string | null;
  style?: CSSProperties;
}

type Step =
  | { kind: "credentials" }
  | { kind: "setup"; mfaToken: string; email: string }
  | { kind: "verify"; mfaToken: string; email: string }
  | {
      kind: "recovery";
      token: string;
      codes: string[];
      email: string;
      mustChangePassword: boolean;
      roles: RoleChoice;
    }
  | { kind: "password"; token: string; email: string; roles: RoleChoice }
  | { kind: "role"; token: string; email: string; roles: RoleChoice }
  // Recuperación de contraseña: correo → código → contraseña nueva → vuelve al ingreso.
  | { kind: "forgot"; email: string }
  | { kind: "resetCode"; email: string }
  | { kind: "resetPassword"; email: string; resetToken: string };

type Notice = { text: string; type: "error" | "success" } | null;

/** Segundos que hay que esperar para pedir otro código (igual que en el backend). */
const RESEND_SECONDS = 60;

/** Roles de la persona y el que viene activo por defecto (el último que usó). */
interface RoleChoice {
  all: string[];
  active: string;
}

/** Patrón de panal (hexágonos) para el fondo del panel de marca. */
const HONEYCOMB =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='56' height='100'><path d='M28 66L0 50V16L28 0l28 16v34L28 66v34M28 0v0' fill='none' stroke='#fff' stroke-width='1'/><path d='M28 0v34L0 50v34l28 16 28-16V50L28 34' fill='none' stroke='#fff' stroke-width='1'/></svg>",
  );

const FEATURES = [
  {
    icon: "database" as const,
    text: "Base de datos dedicada y aislada por organización",
  },
  {
    icon: "lock" as const,
    text: "Acceso con contraseña y verificación en dos pasos",
  },
  { icon: "shield" as const, text: "Gestión confidencial de cada denuncia" },
];

export function LoginCard({
  caption,
  headline,
  tagline,
  description,
  apiBase,
  onAuthenticated,
  footer,
  orgLogoUrl,
  style,
}: Props) {
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [notice, setNotice] = useState<Notice>(null);

  const restart = useCallback(
    (message: string | null, type: "error" | "success" = "error") => {
      setNotice(message ? { text: message, type } : null);
      setStep({ kind: "credentials" });
    },
    [],
  );

  /** Último paso: si tiene varios roles, elige con cuál trabajar; si no, entra directo. */
  function finish(token: string, email: string, roles: RoleChoice) {
    if (roles.all.length > 1) setStep({ kind: "role", token, email, roles });
    else onAuthenticated(token);
  }

  /** Envía el código (de la app o de recuperación) y termina el login. */
  async function verify(mfaToken: string, email: string, code: string) {
    try {
      const res = await api<MfaVerifyResponse>(`${apiBase}/auth/mfa/verify`, {
        method: "POST",
        body: { mfaToken, code },
      });
      const roles = {
        all: res.user.roles ?? [res.user.role],
        active: res.user.role,
      };
      if (res.recoveryCodes?.length) {
        setStep({
          kind: "recovery",
          token: res.token,
          codes: res.recoveryCodes,
          email,
          mustChangePassword: res.mustChangePassword,
          roles,
        });
      } else if (res.mustChangePassword) {
        setStep({ kind: "password", token: res.token, email, roles });
      } else {
        finish(res.token, email, roles);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa_expired")
        return restart(err.message);
      throw err;
    }
  }

  const header = {
    credentials: { eyebrow: null, title: "Iniciar sesión", text: description },
    setup: {
      eyebrow: "Paso 2 de 3",
      title: "Protege tu cuenta",
      text: "La verificación en dos pasos es obligatoria. Vincula tu cuenta con una app de autenticación.",
    },
    verify: {
      eyebrow: null,
      title: "Verificación en dos pasos",
      text: "Ingresa el código de 6 dígitos que muestra tu app de autenticación.",
    },
    recovery: {
      eyebrow: "Paso 3 de 3",
      title: "Guarda tus códigos de recuperación",
      text: "Úsalos para ingresar si pierdes acceso a tu app de autenticación.",
    },
    password: {
      eyebrow: "Último paso",
      title: "Crea tu contraseña",
      text: "Estás usando una contraseña temporal. Elige una nueva para terminar de ingresar.",
    },
    role: {
      eyebrow: null,
      title: "¿Con qué rol quieres trabajar?",
      text: "Tienes varios roles en este canal. Podrás cambiar de rol cuando quieras desde tu menú de usuario.",
    },
    forgot: {
      eyebrow: "Paso 1 de 3",
      title: "¿Olvidaste tu contraseña?",
      text: "Ingresa el correo de tu cuenta y te enviaremos un código para crear una nueva.",
    },
    resetCode: {
      eyebrow: "Paso 2 de 3",
      title: "Revisa tu correo",
      text: "Si el correo corresponde a una cuenta activa, te enviamos un código de 6 dígitos. Vence en 15 minutos.",
    },
    resetPassword: {
      eyebrow: "Paso 3 de 3",
      title: "Crea tu nueva contraseña",
      text: "Al guardarla se cerrarán tus sesiones abiertas. Para ingresar seguirás usando tu app de autenticación.",
    },
  }[step.kind];
  const resetting =
    step.kind === "forgot" ||
    step.kind === "resetCode" ||
    step.kind === "resetPassword";

  return (
    <div className="flex min-h-screen bg-white" style={style}>
      {/* Panel de marca (solo en pantallas grandes) */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-nav p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.09]"
          style={{
            backgroundImage: `url("${HONEYCOMB}")`,
            backgroundSize: "56px 100px",
            maskImage:
              "radial-gradient(ellipse at 70% 30%, black 10%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-48 -right-40 size-[560px] rounded-full bg-highlight/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-56 -left-40 size-[480px] rounded-full bg-brand-navy/60 blur-3xl"
        />

        <div className="relative">
          {orgLogoUrl ? (
            <div className="inline-flex h-16 items-center rounded-2xl bg-white px-5">
              <img
                src={orgLogoUrl}
                alt={caption}
                className="max-h-10 w-auto max-w-[260px] object-contain"
              />
            </div>
          ) : (
            <Brand caption={caption} />
          )}
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[34px] leading-[1.15] font-semibold tracking-tight text-white">
            {headline}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/60">
            {tagline}
          </p>
          <ul className="mt-10 space-y-4">
            {FEATURES.map((f) => (
              <li
                key={f.text}
                className="flex items-center gap-3.5 text-[15px] text-white/80"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                  <Icon name={f.icon} className="size-[18px] text-highlight" />
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>

        {orgLogoUrl ? (
          <p className="relative flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white">
            Powered by <BrandLogo tone="dark" className="h-[18px]" />
          </p>
        ) : (
          <p className="relative text-sm text-white/40">
            © {new Date().getFullYear()} BeeHives · Canal de Denuncias
          </p>
        )}
      </aside>

      {/* Formulario */}
      <main className="flex flex-1 flex-col">
        <div className="px-6 pt-8 sm:px-10 lg:hidden">
          <Brand tone="light" caption={caption} />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
          <div
            className={`w-full ${step.kind === "setup" || step.kind === "recovery" || step.kind === "password" || step.kind === "role" || step.kind === "resetPassword" ? "max-w-[460px]" : "max-w-[400px]"}`}
          >
            {(step.kind === "setup" || step.kind === "verify" || resetting) && (
              <button
                type="button"
                onClick={() => restart(null)}
                className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition hover:text-gray-900"
              >
                <Icon name="arrowLeft" />
                Volver
              </button>
            )}

            {orgLogoUrl && step.kind === "credentials" && (
              <img
                src={orgLogoUrl}
                alt={caption}
                className="mb-8 h-12 w-auto max-w-[240px] object-contain lg:hidden"
              />
            )}
            {header.eyebrow && (
              <p className="mb-2 text-sm font-semibold text-highlight-text">
                {header.eyebrow}
              </p>
            )}
            <h1 className="text-[30px] font-semibold tracking-tight text-gray-900">
              {header.title}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-500">
              {header.text}
            </p>
            {step.kind !== "credentials" && step.kind !== "forgot" && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
                <Icon name="user" className="size-3.5" />
                {step.email}
              </p>
            )}

            <div className="mt-10">
              {step.kind === "credentials" && (
                <CredentialsForm
                  apiBase={apiBase}
                  notice={notice}
                  onSuccess={(res) => {
                    setNotice(null);
                    setStep({
                      kind: res.mfa,
                      mfaToken: res.mfaToken,
                      email: res.user.email,
                    });
                  }}
                  onForgot={(email) => {
                    setNotice(null);
                    setStep({ kind: "forgot", email });
                  }}
                />
              )}
              {step.kind === "forgot" && (
                <ForgotForm
                  apiBase={apiBase}
                  initialEmail={step.email}
                  onSent={(email) => setStep({ kind: "resetCode", email })}
                />
              )}
              {step.kind === "resetCode" && (
                <ResetCodeForm
                  apiBase={apiBase}
                  email={step.email}
                  onVerified={(resetToken) =>
                    setStep({
                      kind: "resetPassword",
                      email: step.email,
                      resetToken,
                    })
                  }
                />
              )}
              {step.kind === "resetPassword" && (
                <ChangePasswordForm
                  apiBase={apiBase}
                  resetToken={step.resetToken}
                  submitLabel="Guardar contraseña"
                  onChanged={() =>
                    restart(
                      "Tu contraseña se cambió. Ingresa con ella para continuar.",
                      "success",
                    )
                  }
                />
              )}
              {step.kind === "setup" && (
                <MfaSetupStep
                  apiBase={apiBase}
                  mfaToken={step.mfaToken}
                  onExpired={restart}
                  onVerify={(code) => verify(step.mfaToken, step.email, code)}
                />
              )}
              {step.kind === "verify" && (
                <MfaVerifyStep
                  onVerify={(code) => verify(step.mfaToken, step.email, code)}
                />
              )}
              {step.kind === "password" && (
                <ChangePasswordForm
                  apiBase={apiBase}
                  token={step.token}
                  submitLabel="Guardar y entrar"
                  onChanged={(token) => finish(token, step.email, step.roles)}
                />
              )}
              {step.kind === "role" && (
                <RolePicker
                  apiBase={apiBase}
                  token={step.token}
                  roles={step.roles}
                  onSelected={onAuthenticated}
                />
              )}
              {step.kind === "recovery" && (
                <RecoveryCodesStep
                  codes={step.codes}
                  account={step.email}
                  onContinue={() =>
                    step.mustChangePassword
                      ? setStep({
                          kind: "password",
                          token: step.token,
                          email: step.email,
                          roles: step.roles,
                        })
                      : finish(step.token, step.email, step.roles)
                  }
                />
              )}
            </div>

            {step.kind === "credentials" && (
              <div className="mt-10 flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3.5 text-sm text-gray-500 ring-1 ring-inset ring-gray-200/70">
                <Icon
                  name="lock"
                  className="mt-0.5 size-4 shrink-0 text-gray-400"
                />
                Acceso restringido a usuarios autorizados. La actividad en esta
                plataforma puede ser registrada.
              </div>
            )}
            {step.kind === "credentials" && footer}
          </div>
        </div>
      </main>
    </div>
  );
}

function CredentialsForm({
  apiBase,
  notice,
  onSuccess,
  onForgot,
}: {
  apiBase: string;
  notice: Notice;
  onSuccess: (res: LoginStartResponse) => void;
  onForgot: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      onSuccess(
        await api<LoginStartResponse>(`${apiBase}/auth/login`, {
          method: "POST",
          body: { email, password },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <Alert>{error}</Alert>
      ) : (
        notice && <Alert type={notice.type}>{notice.text}</Alert>
      )}
      <Field
        label="Correo electrónico"
        type="email"
        autoComplete="email"
        placeholder="nombre@empresa.com"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="-mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onForgot(email)}
          className="text-sm font-medium text-highlight-text hover:underline"
        >
          ¿Olvidaste tu contraseña?
        </button>
      </div>
      <Button
        type="submit"
        variant="primary"
        loading={loading}
        className="h-11 w-full text-[15px]"
      >
        Continuar
      </Button>
    </form>
  );
}

/** Paso 1 de la recuperación: pide el código por correo. */
function ForgotForm({
  apiBase,
  initialEmail,
  onSent,
}: {
  apiBase: string;
  initialEmail: string;
  onSent: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api(`${apiBase}/auth/password-reset/request`, {
        method: "POST",
        body: { email },
      });
      onSent(email.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <Alert>{error}</Alert>}
      <Field
        label="Correo electrónico"
        type="email"
        autoComplete="email"
        placeholder="nombre@empresa.com"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button
        type="submit"
        variant="primary"
        loading={loading}
        className="mt-3 h-11 w-full text-[15px]"
      >
        Enviar código
      </Button>
    </form>
  );
}

/** Paso 2 de la recuperación: ingresa el código que llegó al correo (y puede pedir otro). */
function ResetCodeForm({
  apiBase,
  email,
  onVerified,
}: {
  apiBase: string;
  email: string;
  onVerified: (resetToken: string) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await api<{ resetToken: string }>(
        `${apiBase}/auth/password-reset/verify`,
        { method: "POST", body: { email, code } },
      );
      onVerified(res.resetToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    setWait(RESEND_SECONDS);
    try {
      await api(`${apiBase}/auth/password-reset/request`, {
        method: "POST",
        body: { email },
      });
      setCode("");
      setInfo("Te enviamos un código nuevo. El anterior ya no sirve.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <Alert>{error}</Alert>}
      {info && <Alert type="success">{info}</Alert>}
      <Field
        label="Código de verificación"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        maxLength={6}
        required
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        mono
      />
      <Button
        type="submit"
        variant="primary"
        loading={loading}
        disabled={code.length !== 6}
        className="mt-3 h-11 w-full text-[15px]"
      >
        Verificar código
      </Button>
      <p className="text-center text-sm text-gray-500">
        ¿No te llegó? Revisa tu carpeta de spam o{" "}
        {wait > 0 ? (
          <span>pide otro en {wait} s.</span>
        ) : (
          <button
            type="button"
            onClick={resend}
            className="font-medium text-highlight-text hover:underline"
          >
            envía un código nuevo
          </button>
        )}
      </p>
    </form>
  );
}

/** Selección del rol con el que se trabajará en esta sesión. */
function RolePicker({
  apiBase,
  token,
  roles,
  onSelected,
}: {
  apiBase: string;
  token: string;
  roles: RoleChoice;
  onSelected: (token: string) => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ordered = ROLE_ORDER.filter((r) => roles.all.includes(r));

  async function choose(role: TenantRole) {
    setError(null);
    setLoading(role);
    try {
      const res = await api<{ token: string }>(`${apiBase}/auth/switch-role`, {
        method: "POST",
        token,
        body: { role },
      });
      onSelected(res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {ordered.map((r) => (
        <button
          key={r}
          type="button"
          disabled={loading !== null}
          onClick={() => choose(r)}
          className={`group flex w-full items-center gap-4 rounded-xl p-4 text-left ring-1 transition ring-inset disabled:opacity-60 ${
            r === roles.active
              ? "bg-accent-soft ring-highlight/50"
              : "ring-line hover:bg-gray-50 hover:ring-gray-300"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              {ROLES[r].label}
              {r === roles.active && (
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-highlight-text ring-1 ring-highlight/30">
                  Último usado
                </span>
              )}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-gray-500">
              {ROLES[r].description}
            </span>
          </span>
          {loading === r ? (
            <span className="size-5 shrink-0 animate-spin rounded-full border-2 border-accent border-r-transparent" />
          ) : (
            <Icon
              name="chevron"
              className="size-4 shrink-0 text-gray-400 transition group-hover:translate-x-0.5"
            />
          )}
        </button>
      ))}
    </div>
  );
}
