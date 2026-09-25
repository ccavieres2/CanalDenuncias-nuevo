import { HttpError } from "../errors.js";
import { storage } from "../storage/index.js";
import { brandingLogoKey } from "../storage/keys.js";
import { saveSetting } from "./channel.js";
import { type Tenant, listTenants, tenantPool } from "./tenants.js";

/**
 * Marca de cada empresa: logo y color principal. Se aplica a su portal de denuncias, su pantalla de ingreso y su
 * panel. El color y la referencia al logo se guardan en la base de la empresa (settings.branding); la imagen, en el
 * almacenamiento de archivos: <empresa>/branding/logo-<fecha>.<ext> (carpeta local o S3).
 */
export interface StoredLogo {
  /** Clave en el almacenamiento de archivos. */
  key: string;
  mime: string;
  updatedAt: string;
}

export interface Branding {
  primaryColor: string | null;
  logo: StoredLogo | null;
}

/** Formato anterior: la imagen en base64 dentro de la base. Se migra al almacenamiento al arrancar. */
type LegacyLogo = { mime: string; data: string; updatedAt: string };

const LOGO_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};
export const LOGO_MAX_BYTES = 300 * 1024;

async function readRaw(tenant: Tenant): Promise<{ primaryColor?: string | null; logo?: StoredLogo | LegacyLogo | null }> {
  const res = await tenantPool(tenant).query<{ value: Record<string, unknown> }>("SELECT value FROM settings WHERE key = 'branding'");
  return (res.rows[0]?.value ?? {}) as { primaryColor?: string | null; logo?: StoredLogo | LegacyLogo | null };
}

export async function getBranding(tenant: Tenant): Promise<Branding> {
  const v = await readRaw(tenant);
  const logo = v.logo && "key" in v.logo ? v.logo : null;
  return { primaryColor: v.primaryColor ?? null, logo };
}

/** Lo que ven el portal, la pantalla de ingreso y el panel. */
export async function publicBranding(tenant: Tenant) {
  const b = await getBranding(tenant);
  return {
    primaryColor: b.primaryColor,
    logoUrl: b.logo ? `/api/t/${tenant.slug}/public/logo?v=${encodeURIComponent(b.logo.updatedAt)}` : null,
  };
}

/** Imagen del logo desde el almacenamiento. */
export async function readLogo(tenant: Tenant): Promise<{ body: Buffer; mime: string } | null> {
  const { logo } = await getBranding(tenant);
  if (!logo) return null;
  const body = await storage.get(logo.key);
  return body ? { body, mime: logo.mime } : null;
}

/** Contraste WCAG entre un color y el blanco (el texto de los botones es blanco). */
export function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (lum + 0.05);
}

export async function setPrimaryColor(tenant: Tenant, color: string | null, userId: string): Promise<Branding> {
  if (color !== null) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, "Color inválido: usa el formato #RRGGBB");
    // Los botones llevan texto blanco: exigimos contraste AA (4,5:1) para que se lean.
    if (contrastWithWhite(color) < 4.5) {
      throw new HttpError(400, "Ese color es muy claro: el texto blanco de los botones no se leería. Elige un tono más oscuro.");
    }
  }
  const current = await getBranding(tenant);
  const next: Branding = { ...current, primaryColor: color?.toLowerCase() ?? null };
  await saveSetting(tenant, "branding", next, userId);
  return next;
}

/**
 * Recibe el logo como data URL, valida el tipo real por sus primeros bytes (no por lo que declara) y lo guarda en
 * <empresa>/branding/. El logo anterior se borra después de guardar el nuevo.
 */
export async function setLogo(tenant: Tenant, dataUrl: string | null, userId: string): Promise<Branding> {
  const current = await getBranding(tenant);
  let logo: StoredLogo | null = null;
  if (dataUrl !== null) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new HttpError(400, "Sube una imagen PNG, JPG o WebP.");
    const mime = m[1]!;
    const bytes = Buffer.from(m[2]!, "base64");
    if (bytes.length > LOGO_MAX_BYTES) throw new HttpError(400, "El logo supera los 300 KB. Reduce su tamaño.");
    if (!LOGO_TYPES[mime]!(bytes)) throw new HttpError(400, "El archivo no es una imagen válida.");
    const key = brandingLogoKey(tenant.slug, mime);
    await storage.put(key, bytes, mime);
    logo = { key, mime, updatedAt: new Date().toISOString() };
  }
  const next: Branding = { ...current, logo };
  await saveSetting(tenant, "branding", next, userId);
  if (current.logo && current.logo.key !== logo?.key) await storage.remove(current.logo.key).catch(() => undefined);
  return next;
}

/** Datos de marca para el panel de administración. */
export const brandingForAdmin = (tenant: Tenant, b: Branding) => ({
  primaryColor: b.primaryColor,
  logoUrl: b.logo ? `/api/t/${tenant.slug}/public/logo?v=${encodeURIComponent(b.logo.updatedAt)}` : null,
});

/**
 * Migración: los logos guardados en base64 dentro de la base (versión anterior) pasan al almacenamiento de archivos.
 * Es idempotente: solo actúa sobre las empresas que aún tienen el formato antiguo.
 */
export async function migrateLegacyLogos(): Promise<void> {
  for (const tenant of await listTenants()) {
    if (tenant.status === "provisioning") continue;
    const raw = await readRaw(tenant).catch(() => null);
    if (!raw?.logo || !("data" in raw.logo)) continue;
    const { mime, data, updatedAt } = raw.logo;
    const key = brandingLogoKey(tenant.slug, mime);
    await storage.put(key, Buffer.from(data, "base64"), mime);
    await tenantPool(tenant).query("UPDATE settings SET value = $1 WHERE key = 'branding'", [
      { primaryColor: raw.primaryColor ?? null, logo: { key, mime, updatedAt } },
    ]);
    console.log(`[almacenamiento] logo de ${tenant.slug} movido a ${key}`);
  }
}
