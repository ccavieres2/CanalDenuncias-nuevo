import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import type { Credentials } from "../lib/types";
import { Alert, Button, Icon, Modal } from "./ui";

/* ---------------------------------------------------------------- Confirmación */

/** Confirmación de una acción. `onConfirm` puede fallar: el error se muestra en el mismo diálogo. */
export function ConfirmModal({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm leading-relaxed text-gray-600">
        {error && <Alert>{error}</Alert>}
        {children}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Credenciales temporales */

/**
 * Muestra una contraseña temporal recién generada. No se vuelve a mostrar: el
 * administrador debe entregarla por un canal seguro.
 */
export function CredentialsModal({
  title,
  credentials,
  loginUrl,
  onClose,
}: {
  title: string;
  credentials: Credentials;
  loginUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"password" | "all" | null>(null);
  const fullUrl = `${window.location.origin}${loginUrl}`;

  async function copy(kind: "password" | "all") {
    const text =
      kind === "password"
        ? credentials.temporaryPassword
        : `Acceso: ${fullUrl}\nUsuario: ${credentials.email}\nContraseña temporal: ${credentials.temporaryPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Sin permiso de portapapeles: el texto se puede seleccionar a mano.
    }
  }

  return (
    <Modal
      title={title}
      description="Esta contraseña se muestra una sola vez."
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => copy("all")}>
            <Icon name={copied === "all" ? "check" : "copy"} />
            {copied === "all" ? "Copiado" : "Copiar todo"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <dl className="divide-y divide-line-soft rounded-lg ring-1 ring-line">
          <div className="px-4 py-3">
            <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">URL de acceso</dt>
            <dd className="mt-1 font-mono text-sm break-all text-gray-900">{fullUrl}</dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">Usuario</dt>
            <dd className="mt-1 text-sm break-all text-gray-900">{credentials.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 bg-gray-50/70 px-4 py-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">Contraseña temporal</dt>
              <dd className="mt-1 font-mono text-lg font-medium tracking-wide text-gray-900">
                {credentials.temporaryPassword}
              </dd>
            </div>
            <button
              onClick={() => copy("password")}
              aria-label="Copiar contraseña"
              className="shrink-0 rounded-md p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            >
              <Icon name={copied === "password" ? "check" : "copy"} />
            </button>
          </div>
        </dl>
        <Alert type="info">
          Entrégala por un canal seguro. Al ingresar, la persona deberá cambiarla y configurar la verificación en dos
          pasos.
        </Alert>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Menú de acciones por fila */

export interface RowAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/**
 * Botón "⋯" con un menú de acciones. Se posiciona con `fixed` para que no lo
 * recorten los contenedores con scroll (tablas).
 */
export function RowMenu({ actions, label = "Acciones" }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visible = actions.filter((a) => !a.hidden);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const menuHeight = menu.current?.offsetHeight ?? 0;
    const below = r.bottom + 6 + menuHeight <= window.innerHeight;
    setPos({ top: below ? r.bottom + 6 : r.top - 6 - menuHeight, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (menu.current?.contains(e.target as Node) || button.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!visible.length) return null;

  return (
    <>
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
      >
        <Icon name="dots" className="size-[18px]" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }}
          className="fixed z-50 min-w-56 overflow-hidden rounded-xl border border-line bg-white py-1.5 shadow-pop"
        >
          {visible.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className={`block w-full px-4 py-2.5 text-left text-sm transition hover:bg-gray-50 ${
                a.danger ? "text-red-700" : "text-gray-700"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
