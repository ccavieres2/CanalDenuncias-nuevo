import type { CSSProperties } from "react";

/** Marca pública de una empresa (color principal y logo). */
export interface PublicBranding {
  primaryColor: string | null;
  logoUrl: string | null;
}

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** Mezcla un color con otro (0 = el primero, 1 = el segundo). */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return `#${hex(ar! + (br! - ar!) * t)}${hex(ag! + (bg! - ag!) * t)}${hex(ab! + (bb! - ab!) * t)}`;
}

/** Contraste WCAG contra blanco (los botones llevan texto blanco). */
export function contrastWithWhite(color: string): number {
  const lum = rgb(color)
    .map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * lum[0]! + 0.7152 * lum[1]! + 0.0722 * lum[2]! + 0.05);
}

export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Variables CSS que reemplazan la paleta por la de la empresa en todo lo que esté dentro del elemento
 * (botones, enlaces, foco, estados activos). Sin color propio se usa la paleta BeeHives.
 */
export function brandStyle(primary: string | null | undefined): CSSProperties | undefined {
  if (!primary || !isHexColor(primary)) return undefined;
  // Menú lateral y paneles de marca: un tono oscuro del color de la empresa, para que el texto blanco se lea.
  const nav = mix(primary, "#000000", 0.62);
  return {
    "--color-nav": nav,
    "--color-nav-hover": mix(nav, "#ffffff", 0.07),
    "--color-nav-line": mix(nav, "#ffffff", 0.1),
    // Sobre el menú oscuro, el activo usa una versión clara del color para que destaque.
    "--color-nav-accent": mix(primary, "#ffffff", 0.45),
    "--color-brand-ink": mix(primary, "#000000", 0.78),
    "--color-brand-navy": primary,
    "--color-accent": primary,
    "--color-accent-hover": mix(primary, "#000000", 0.18),
    "--color-accent-soft": mix(primary, "#ffffff", 0.92),
    "--color-highlight": primary,
    "--color-highlight-text": primary,
  } as CSSProperties;
}
