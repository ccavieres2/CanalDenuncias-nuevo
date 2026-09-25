import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { twMerge } from "tailwind-merge";
import { type Variant, buttonClass } from "../lib/ui-helpers";

/* ---------------------------------------------------------------- Íconos */

export function Icon({ name, className = "size-4" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const ICONS = {
  refresh: (
    <path
      d="M2.5 8a5.5 5.5 0 0 1 9.6-3.7l1.4 1.4M13.5 2.5v3.2h-3.2M13.5 8a5.5 5.5 0 0 1-9.6 3.7l-1.4-1.4M2.5 13.5v-3.2h3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  external: <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" strokeLinecap="round" strokeLinejoin="round" />,
  search: <path d="m13.5 13.5-3-3M11 7A4 4 0 1 1 3 7a4 4 0 0 1 8 0Z" strokeLinecap="round" />,
  chevron: <path d="m6 3.5 4.5 4.5L6 12.5" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="m3.5 3.5 9 9m0-9-9 9" strokeLinecap="round" />,
  plus: <path d="M8 3v10M3 8h10" strokeLinecap="round" />,
  building: <path d="M2.5 13.5h11M3.5 13.5v-11h6v11M9.5 6.5h3v7M5.5 5h2M5.5 7.5h2M5.5 10h2" strokeLinecap="round" />,
  error: <path d="M8 5v3.5M8 11h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" strokeLinecap="round" />,
  success: <path d="m5.5 8 1.8 1.8L10.8 6.3M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" strokeLinecap="round" strokeLinejoin="round" />,
  user: <path d="M10.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5" strokeLinecap="round" />,
  users: (
    <path
      d="M8.5 5.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM1.5 13.5c.5-2 2.3-3 4.5-3s4 1 4.5 3M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 10.7c1.2.4 2.1 1.4 2.5 2.8"
      strokeLinecap="round"
    />
  ),
  logout: <path d="M6.5 13.5h-3v-11h3M10.5 11 13.5 8l-3-3M13.5 8h-7" strokeLinecap="round" strokeLinejoin="round" />,
  shield: <path d="M8 1.8 13 3.7v4c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5v-4l5-1.9Z" strokeLinejoin="round" />,
  lock: <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9V7Z" strokeLinejoin="round" />,
  eye: (
    <path
      d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  eyeOff: (
    <path
      d="M2.5 2.5l11 11M6.6 6.6a2 2 0 0 0 2.8 2.8M4.2 4.7C2.5 5.9 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.5-.5 3.5-1.1M7 3.6c.3-.1.7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.5.9-1.4 1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  menu: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />,
  inbox: (
    <path
      d="M2 9.5 3.8 3.3a1 1 0 0 1 1-.8h6.4a1 1 0 0 1 1 .8L14 9.5v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3ZM2 9.5h3.5l1 1.5h3l1-1.5H14"
      strokeLinejoin="round"
    />
  ),
  calendar: <path d="M2.5 4.5h11v9h-11v-9ZM2.5 7h11M5.5 2.5v3M10.5 2.5v3" strokeLinecap="round" strokeLinejoin="round" />,
  mail: <path d="M2 4h12v8.5H2V4Zm0 .5 6 4.5 6-4.5" strokeLinejoin="round" />,
  chart: <path d="M2.5 13.5h11M4.5 11V7.5M8 11V4M11.5 11V9" strokeLinecap="round" />,
  book: <path d="M8 4.2C6.8 3.2 4.9 2.8 2.5 3v9.5c2.4-.2 4.3.2 5.5 1.2 1.2-1 3.1-1.4 5.5-1.2V3c-2.4-.2-4.3.2-5.5 1.2Zm0 0v9.5" strokeLinejoin="round" />,
  userPlus: <path d="M9 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM1.5 13.5c.6-2.3 2.6-3.5 5-3.5 1 0 1.9.2 2.7.6M12.5 9v4M10.5 11h4" strokeLinecap="round" />,
  archive: <path d="M2 3h12v3H2V3Zm1 3v7.5h10V6M6.5 8.5h3" strokeLinecap="round" strokeLinejoin="round" />,
  dots: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeLinecap="round" strokeWidth="2.2" />,
  grid: <path d="M2.5 2.5h4.5V7H2.5V2.5ZM9 2.5h4.5V7H9V2.5ZM2.5 9H7v4.5H2.5V9ZM9 9h4.5v4.5H9V9Z" strokeLinejoin="round" />,
  activity: <path d="M1.5 8h3l2-5 3 10 2-5h3" strokeLinecap="round" strokeLinejoin="round" />,
  server: (
    <path
      d="M2.5 2.5h11v4.5h-11V2.5ZM2.5 9h11v4.5h-11V9ZM5 4.75h.01M5 11.25h.01"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  settings: (
    <path
      d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM13 8.9V7.1l-1.6-.4-.4-1 .9-1.4-1.2-1.2-1.4.9-1-.4L7.9 2H6.1l-.4 1.6-1 .4-1.4-.9-1.2 1.2.9 1.4-.4 1L1 7.1v1.8l1.6.4.4 1-.9 1.4 1.2 1.2 1.4-.9 1 .4.4 1.6h1.8l.4-1.6 1-.4 1.4.9 1.2-1.2-.9-1.4.4-1L13 8.9Z"
      strokeLinejoin="round"
    />
  ),
  clock: <path d="M8 4.5V8l2.5 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" strokeLinecap="round" strokeLinejoin="round" />,
  pencil: <path d="m10.5 2.5 3 3L6 13H3v-3l7.5-7.5Z" strokeLinejoin="round" />,
  flow: (
    <path
      d="M4 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM4 5.5v2.5a2 2 0 0 0 2 2h4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  palette: (
    <path
      d="M8 1.5a6.5 6.5 0 0 0 0 13c.9 0 1.3-.6 1.3-1.2 0-.8-.7-1.1-.7-1.9 0-.7.6-1.2 1.3-1.2h1.5a3.1 3.1 0 0 0 3.1-3.1C14.5 4 11.6 1.5 8 1.5ZM4.8 7.2h.01M6.8 4.6h.01M10 4.6h.01"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  check: <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />,
  phone: <path d="M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM7 12.5h2" strokeLinecap="round" />,
  copy: <path d="M5.5 5.5v-3h8v8h-3M2.5 5.5h8v8h-8v-8Z" strokeLinejoin="round" />,
  download: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" strokeLinecap="round" strokeLinejoin="round" />,
  arrowLeft: <path d="M13 8H3M7 4 3 8l4 4" strokeLinecap="round" strokeLinejoin="round" />,
  key: <path d="M10 2.5a3.5 3.5 0 1 1-2.9 5.5L2.5 12.6v1h2v-1.5H6v-1.5h1.5l.5-.5A3.5 3.5 0 0 1 10 2.5ZM11 5.5h.01" strokeLinecap="round" strokeLinejoin="round" />,
  database: (
    <path
      d="M13 3.5c0 1.1-2.2 2-5 2s-5-.9-5-2m10 0c0-1.1-2.2-2-5-2s-5 .9-5 2m10 0v9c0 1.1-2.2 2-5 2s-5-.9-5-2v-9m10 4.5c0 1.1-2.2 2-5 2s-5-.9-5-2"
      strokeLinecap="round"
    />
  ),
};

/* ---------------------------------------------------------------- Botones */

export function Button({
  variant = "normal",
  loading,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button {...props} disabled={props.disabled || loading} className={buttonClass(variant, className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Formularios */

const inputBase =
  "block h-11 w-full rounded-lg border bg-white px-3.5 text-base text-gray-900 sm:text-sm shadow-sm outline-none transition placeholder:text-gray-400 focus:ring-4";

export function Field({
  label,
  description,
  error,
  hint,
  mono,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
  error?: string;
  hint?: ReactNode;
  mono?: boolean;
}) {
  const isPassword = props.type === "password";
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-800">{label}</span>
      {description && <span className="mt-0.5 block text-sm text-gray-500">{description}</span>}
      <div className="relative mt-2">
        <input
          {...props}
          type={isPassword && visible ? "text" : props.type}
          aria-invalid={!!error}
          className={`${inputBase} ${
            error
              ? "border-red-400 focus:border-red-500 focus:ring-red-100"
              : "border-gray-300 focus:border-highlight focus:ring-highlight/20"
          } ${mono ? "font-mono" : ""} ${isPassword ? "pr-11" : ""}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-gray-400 transition hover:text-gray-700 focus-visible:text-highlight-text focus-visible:outline-none"
          >
            <Icon name={visible ? "eyeOff" : "eye"} className="size-[18px]" />
          </button>
        )}
      </div>
      {error ? (
        <span className="mt-1.5 flex items-center gap-1.5 text-sm text-red-600">
          <Icon name="error" className="size-4 shrink-0" />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-gray-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={twMerge(inputBase, "h-10 border-gray-300 pl-10 focus:border-highlight focus:ring-highlight/20")}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Mensajes */

export function Alert({ type = "error", children }: { type?: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "bg-red-50 text-red-800 ring-red-200",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    info: "bg-accent-soft text-gray-800 ring-highlight/25",
  }[type];
  const iconColor = { error: "text-red-500", success: "text-emerald-600", info: "text-highlight-text" }[type];
  return (
    <div role={type === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${styles}`}>
      <Icon name={type === "success" ? "success" : "error"} className={`mt-0.5 size-4 shrink-0 ${iconColor}`} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas text-highlight">
      <Spinner className="size-7" />
    </div>
  );
}

/* ---------------------------------------------------------------- Estado */

export type Status = "provisioning" | "active" | "suspended";

export function StatusIndicator({ status }: { status: Status }) {
  const { styles, dot, label } = {
    active: { styles: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", dot: "bg-emerald-500", label: "Activa" },
    suspended: { styles: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500", label: "Suspendida" },
    provisioning: { styles: "bg-gray-100 text-gray-700 ring-gray-500/15", dot: "bg-gray-400", label: "Aprovisionando" },
  }[status];
  return <Badge styles={styles} dot={dot} label={label} />;
}

export function Badge({ styles, dot, label }: { styles: string; dot: string; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${styles}`}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export function Avatar({ label, className = "size-9 text-sm" }: { label: string; className?: string }) {
  return (
    <span className={twMerge("inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent", className)}>
      {label}
    </span>
  );
}

/* ---------------------------------------------------------------- Estructura */

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Ruta" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <Icon name="chevron" className="size-3.5 text-gray-300" />}
          {item.to ? (
            <Link to={item.to} className="text-gray-500 transition hover:text-gray-900">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-gray-900">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight text-gray-900 sm:text-[28px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">{actions}</div>}
    </div>
  );
}

/** Contenedor blanco con encabezado, el bloque básico de todas las pantallas. */
export function Panel({
  title,
  counter,
  description,
  actions,
  toolbar,
  children,
  flush,
}: {
  title?: ReactNode;
  counter?: number;
  description?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  /** Sin padding interno (para tablas). */
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      {title && (
        <header className="border-b border-line-soft px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                {title}
                {counter !== undefined && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{counter}</span>
                )}
              </h2>
              {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
            </div>
            {actions && <div className="flex items-center gap-3">{actions}</div>}
          </div>
          {toolbar && <div className="mt-4 sm:mt-5">{toolbar}</div>}
        </header>
      )}
      <div className={flush ? "" : "px-4 py-5 sm:px-6 sm:py-6"}>{children}</div>
    </section>
  );
}

export function KeyValue({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium break-words text-gray-900">{children}</dd>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center sm:px-6 sm:py-16">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <Icon name="building" className="size-5" />
      </div>
      <p className="text-base font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Tablas */

export const th = "px-6 py-3 text-left text-xs font-medium tracking-wide text-gray-500 uppercase whitespace-nowrap";
export const td = "px-6 py-4 text-sm text-gray-700 whitespace-nowrap";

/* ---------------------------------------------------------------- Modal */

const MODAL_WIDTHS = { md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof MODAL_WIDTHS;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-gray-950/40 backdrop-blur-[2px] sm:items-start sm:p-6 sm:pt-[8vh]">
      <div className="absolute inset-0" onClick={onClose} />
      <div role="dialog" aria-modal className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-pop sm:max-h-none sm:overflow-visible sm:rounded-2xl ${MODAL_WIDTHS[size]}`}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
          </div>
          <button onClick={onClose} className="-m-1 rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700" aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6 sm:py-6">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-line-soft bg-gray-50/70 px-5 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:rounded-b-2xl sm:px-6 [&>*]:w-full sm:[&>*]:w-auto">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Indicadores */

export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  icon: keyof typeof ICONS;
  tone?: "neutral" | "success" | "warning";
}) {
  const iconStyles = {
    neutral: "bg-accent-soft text-highlight-text",
    success: "bg-emerald-50 text-emerald-600",
    warning: "bg-amber-50 text-amber-600",
  }[tone];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white px-3.5 py-3 shadow-card sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-11 ${iconStyles}`}>
        <Icon name={icon} className="size-4 sm:size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-gray-500 sm:text-sm">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{value}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Select */

export function Select({
  value,
  onChange,
  children,
  ...props
}: { value: string; onChange: (v: string) => void; children: ReactNode } & Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange"
>) {
  return (
    <div className="relative">
      <select
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white pr-10 pl-3.5 text-base text-gray-900 shadow-sm outline-none transition focus:border-highlight focus:ring-4 focus:ring-highlight/20 sm:text-sm"
      >
        {children}
      </select>
      <Icon
        name="chevron"
        className="pointer-events-none absolute top-1/2 right-3.5 size-3.5 -translate-y-1/2 rotate-90 text-gray-400"
      />
    </div>
  );
}

/** Área de texto con el mismo estilo que Field. */
export function TextArea({
  label,
  hint,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-800">{label}</span>
      <textarea
        {...props}
        className="mt-2 block min-h-24 w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-base text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-highlight focus:ring-4 focus:ring-highlight/20 sm:text-sm"
      />
      {hint && <span className="mt-1.5 block text-sm text-gray-500">{hint}</span>}
    </label>
  );
}

/* ---------------------------------------------------------------- Interruptor */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {description && <span className="mt-1 block text-sm text-gray-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight ${
          checked ? "bg-accent" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
