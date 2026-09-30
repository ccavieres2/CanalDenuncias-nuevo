import { type FormEvent, useState } from "react";
import { ApiError, api } from "../lib/api";
import { Alert, Button, Field } from "./ui";

/** Reglas visibles de la política de contraseñas (las mismas que valida el backend). */
const RULES = [
  { label: "Al menos 10 caracteres", test: (v: string) => v.length >= 10 },
  { label: "Al menos una letra", test: (v: string) => /[A-Za-zÀ-ÿ]/.test(v) },
  { label: "Al menos un número", test: (v: string) => /\d/.test(v) },
];

/**
 * Cambio de contraseña. Se usa en el login (contraseña temporal), en "Mi cuenta" y al recuperarla por correo
 * (con `resetToken` en vez de sesión: no pide la contraseña actual).
 * Con sesión, el backend responde con una nueva porque el cambio invalida las anteriores.
 */
export function ChangePasswordForm({
  apiBase,
  token,
  resetToken,
  submitLabel = "Cambiar contraseña",
  onChanged,
}: {
  apiBase: string;
  token?: string;
  resetToken?: string;
  submitLabel?: string;
  onChanged: (newToken: string) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== next;
  const valid =
    RULES.every((r) => r.test(next)) &&
    next === confirm &&
    (resetToken !== undefined || current.length > 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setFields({});
    setLoading(true);
    try {
      if (resetToken !== undefined) {
        await api(`${apiBase}/auth/password-reset/complete`, {
          method: "POST",
          body: { resetToken, newPassword: next },
        });
        onChanged("");
        return;
      }
      const res = await api<{ token: string }>(
        `${apiBase}/auth/change-password`,
        {
          method: "POST",
          token,
          body: { currentPassword: current, newPassword: next },
        },
      );
      onChanged(res.token);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_current_password") {
        setFields({ currentPassword: err.message });
      } else {
        setError(err instanceof ApiError ? err.message : "Error inesperado");
        setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <Alert>{error}</Alert>}
      {resetToken === undefined && (
        <Field
          label="Contraseña actual"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          error={fields.currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      )}
      <div>
        <Field
          label="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          error={fields.newPassword}
          onChange={(e) => setNext(e.target.value)}
        />
        <ul className="mt-2.5 grid gap-1.5 text-sm sm:grid-cols-3">
          {RULES.map((r) => {
            const ok = r.test(next);
            return (
              <li
                key={r.label}
                className={`flex items-center gap-1.5 ${ok ? "text-emerald-700" : "text-gray-500"}`}
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
                    ok ? "bg-emerald-500 text-white" : "bg-gray-200"
                  }`}
                >
                  {ok && (
                    <svg
                      viewBox="0 0 16 16"
                      className="size-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path
                        d="m4 8.5 2.5 2.5L12 5.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                {r.label}
              </li>
            );
          })}
        </ul>
      </div>
      <Field
        label="Confirma la nueva contraseña"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        error={mismatch ? "Las contraseñas no coinciden" : undefined}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <Button
        type="submit"
        variant="primary"
        loading={loading}
        disabled={!valid}
        className="h-11 w-full sm:w-auto"
      >
        {submitLabel}
      </Button>
    </form>
  );
}
