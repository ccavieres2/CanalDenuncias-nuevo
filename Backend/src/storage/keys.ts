import { randomUUID } from "node:crypto";
import type { LegalFramework } from "../services/channel.js";

/**
 * Estructura de carpetas, igual en la carpeta local y en S3. Cada empresa tiene su propio prefijo (como su propia
 * base de datos) y nada se comparte entre empresas:
 *
 *   <empresa>/branding/logo-<fecha>.<ext>
 *   <empresa>/denuncias/<ley>/<código de denuncia>/<id>-<nombre del archivo>
 */

/** Carpeta de cada marco legal dentro de «denuncias». */
export const FRAMEWORK_FOLDER: Record<LegalFramework, string> = {
  ley_karin: "ley-karin",
  ley_20393: "delitos-ley-20393",
  ley_21719: "datos-personales-ley-21719",
  internal: "normativa-interna",
};

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const tenantPrefix = (slug: string) => slug;

export function brandingLogoKey(slug: string, mime: string): string {
  return `${tenantPrefix(slug)}/branding/logo-${Date.now()}.${EXTENSIONS[mime] ?? "bin"}`;
}

/** Nombre de archivo seguro: sin tildes ni caracteres especiales, conservando la extensión. */
export function safeFileName(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(-80);
  return clean || "archivo";
}

/** Carpeta de los archivos de una denuncia. */
export function caseFolder(slug: string, framework: LegalFramework, caseCode: string): string {
  return `${tenantPrefix(slug)}/denuncias/${FRAMEWORK_FOLDER[framework]}/${caseCode}`;
}

/** Clave de un archivo (evidencia) de una denuncia. El id evita choques entre archivos con el mismo nombre. */
export function caseFileKey(slug: string, framework: LegalFramework, caseCode: string, fileName: string): string {
  return `${caseFolder(slug, framework, caseCode)}/${randomUUID()}-${safeFileName(fileName)}`;
}
