/** Helpers de estilo y formato compartidos por los componentes. */

import { twMerge } from "tailwind-merge";

export type Variant = "primary" | "normal" | "danger" | "link";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-sm hover:bg-accent-hover",
  normal: "bg-white text-gray-800 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50",
  danger: "bg-white text-red-700 shadow-sm ring-1 ring-inset ring-red-200 hover:bg-red-50",
  link: "text-gray-700 hover:bg-gray-100 hover:text-gray-900",
};

/** Clases de botón. `extra` puede sobrescribir las base (p. ej. "h-9" o "px-0") gracias a twMerge. */
export function buttonClass(variant: Variant = "normal", extra = "") {
  return twMerge(
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    extra,
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function formatDate(value: string | null, withTime = false): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
