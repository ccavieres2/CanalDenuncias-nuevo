import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Cifrado simétrico (AES-256-GCM) para datos sensibles guardados en la base,
 * como el secreto TOTP. Si alguien obtiene un respaldo de la base, no puede
 * generar códigos sin esta clave.
 */

const KEY = createHash("sha256").update(config.mfaEncryptionKey).digest();
const VERSION = "v1";

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Formato de secreto cifrado desconocido");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Cifrado de ajustes sensibles (contraseñas SMTP) con su propia clave: SETTINGS_ENCRYPTION_KEY, o si no está,
 * una derivada de MFA_ENCRYPTION_KEY (distinta de la del 2FA).
 */
const SETTINGS_KEY = createHash("sha256")
  .update(`settings:${config.settingsEncryptionKey ?? config.mfaEncryptionKey}`)
  .digest();
const SETTINGS_VERSION = "s1";

export function encryptSetting(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SETTINGS_KEY, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [SETTINGS_VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSetting(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== SETTINGS_VERSION || !iv || !tag || !data) throw new Error("Formato de ajuste cifrado desconocido");
  const decipher = createDecipheriv("aes-256-gcm", SETTINGS_KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Hash para valores aleatorios de alta entropía (códigos de recuperación). */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
