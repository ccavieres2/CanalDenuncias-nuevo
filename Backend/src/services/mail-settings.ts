import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { z } from "zod";
import { config } from "../config.js";
import { globalPool } from "../db/pool.js";
import { HttpError } from "../errors.js";
import { decryptSetting, encryptSetting } from "./secrets.js";
import { layout } from "./mail-template.js";
import { type Tenant, tenantPool } from "./tenants.js";

/**
 * Correo saliente configurable desde la aplicación:
 *   - Plataforma (consola BeeHives): SMTP por defecto para todas las empresas y para la consola.
 *   - Cada empresa (client_admin): SMTP propio, opcional. Si no tiene, usa el de la plataforma.
 * Sirve cualquier servidor SMTP con usuario y contraseña (o sin autenticación, para relays internos):
 * Microsoft 365 / Exchange, Gmail / Google Workspace, Amazon SES, SendGrid, Brevo, Mailgun, Zoho, etc.
 * La contraseña se guarda cifrada y nunca se devuelve a la interfaz.
 */

export type MailSecurity = "starttls" | "tls" | "none";

export interface StoredMail {
  host: string;
  port: number;
  security: MailSecurity;
  /** Usuario y contraseña; sin ellos, se envía sin autenticarse (relay interno autorizado por IP). */
  username: string | null;
  passwordEnc: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  /** Validar el certificado del servidor. Solo se desactiva para servidores internos con certificado propio. */
  verifyTls: boolean;
  updatedAt: string;
  lastTest?: { at: string; ok: boolean; error?: string; to?: string };
  /** Último envío real que falló (se usó el correo de respaldo). Se limpia con el siguiente envío correcto. */
  lastFailure?: { at: string; error: string } | null;
}

/** Ámbito de la configuración: la plataforma o una empresa. */
export type MailScope = { kind: "platform" } | { kind: "tenant"; tenant: Tenant };

/** Lo que ve la interfaz: todo menos la contraseña. */
export const publicMail = (m: StoredMail | null) =>
  m && {
    host: m.host,
    port: m.port,
    security: m.security,
    username: m.username,
    passwordSet: !!m.passwordEnc,
    fromName: m.fromName,
    fromEmail: m.fromEmail,
    replyTo: m.replyTo,
    verifyTls: m.verifyTls,
    updatedAt: m.updatedAt,
    lastTest: m.lastTest ?? null,
    lastFailure: m.lastFailure ?? null,
  };

/* ------------------------------------------------------------------ Lectura y escritura */

export async function getMail(scope: MailScope): Promise<StoredMail | null> {
  const res =
    scope.kind === "platform"
      ? await globalPool.query<{ value: StoredMail }>("SELECT value FROM platform_settings WHERE key = 'mail'")
      : await tenantPool(scope.tenant).query<{ value: StoredMail }>("SELECT value FROM settings WHERE key = 'mail'");
  return res.rows[0]?.value ?? null;
}

async function writeMail(scope: MailScope, value: StoredMail, actorId: string | null) {
  const sql = `INSERT INTO ${scope.kind === "platform" ? "platform_settings" : "settings"} (key, value, updated_at, updated_by)
     VALUES ('mail', $1, now(), $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  const pool = scope.kind === "platform" ? globalPool : tenantPool(scope.tenant);
  await pool.query(sql, [value, actorId]);
}

/** Actualiza solo el estado (prueba o falla) sin tocar quién la configuró. */
async function patchStatus(scope: MailScope, patch: Partial<Pick<StoredMail, "lastTest" | "lastFailure">>) {
  const pool = scope.kind === "platform" ? globalPool : tenantPool(scope.tenant);
  const table = scope.kind === "platform" ? "platform_settings" : "settings";
  await pool.query(`UPDATE ${table} SET value = value || $1::jsonb WHERE key = 'mail'`, [JSON.stringify(patch)]);
}

export async function removeMail(scope: MailScope): Promise<boolean> {
  const pool = scope.kind === "platform" ? globalPool : tenantPool(scope.tenant);
  const table = scope.kind === "platform" ? "platform_settings" : "settings";
  const res = await pool.query(`DELETE FROM ${table} WHERE key = 'mail'`);
  return (res.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------------------ Validación */

const email = z.string().trim().toLowerCase().email("Correo inválido").max(254);

export const mailInputSchema = z
  .object({
    host: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Ingresa el servidor")
      .max(253)
      .regex(/^[a-z0-9.-]+$|^\[?[0-9a-f:.]+\]?$/, "Servidor inválido"),
    port: z.coerce.number().int().min(1).max(65535),
    security: z.enum(["starttls", "tls", "none"]),
    username: z.string().trim().max(320).nullable().optional(),
    /** Vacío o ausente = conservar la guardada. */
    password: z.string().max(1000).optional(),
    fromName: z.string().trim().min(1, "Ingresa el nombre del remitente").max(120),
    fromEmail: email,
    replyTo: email.nullable().optional().or(z.literal("").transform(() => null)),
    verifyTls: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.security === "none" && v.username) {
      ctx.addIssue({
        code: "custom",
        path: ["security"],
        message: "Sin cifrado la contraseña viajaría a la vista. Usa STARTTLS o SSL/TLS, o quita el usuario.",
      });
    }
  });
export type MailInput = z.infer<typeof mailInputSchema>;

/** Puertos de correo que puede usar una empresa (la plataforma puede usar cualquiera). */
const TENANT_PORTS = [25, 465, 587, 2525];

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Las empresas solo pueden usar servidores públicos y puertos de correo: así nadie puede usar la prueba de SMTP
 * para llegar a la red interna (la base de datos, los metadatos de AWS, etc.). Devuelve la IP a la que conectarse,
 * ya validada, para que no cambie entre la validación y la conexión.
 * Con ALLOW_PRIVATE_SMTP=true (instalaciones propias) se permiten servidores internos.
 */
async function resolveTarget(scope: MailScope, host: string, port: number): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (scope.kind === "platform" || config.mail.allowPrivateSmtp) return bare;
  if (!TENANT_PORTS.includes(port)) {
    throw new HttpError(400, `Usa uno de los puertos de correo: ${TENANT_PORTS.join(", ")}.`, "invalid_port");
  }
  let addresses: string[];
  try {
    addresses = isIP(bare) ? [bare] : (await lookup(bare, { all: true })).map((a) => a.address);
  } catch {
    throw new HttpError(400, `No se encontró el servidor ${host}. Revisa el nombre.`, "smtp_not_found");
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new HttpError(400, "El servidor debe ser una dirección pública de internet.", "private_host");
  }
  return addresses[0]!;
}

/**
 * Pruebas recientes, por configuración exacta (incluida la contraseña, como hash). Así, si se prueba el formulario y
 * luego se guarda sin cambios, el resultado de esa prueba queda registrado en lo guardado.
 */
const recentTests = new Map<string, { at: string; ok: boolean; error?: string; to?: string; expires: number }>();
const TEST_MEMORY_MS = 30 * 60 * 1000;

function fingerprint(scope: MailScope, c: { host: string; port: number; security: string; username: string | null; password: string | null; fromEmail: string; verifyTls: boolean }) {
  const who = scope.kind === "platform" ? "platform" : `tenant:${scope.tenant.slug}`;
  return createHash("sha256")
    .update(JSON.stringify([who, c.host, c.port, c.security, c.username, c.password, c.fromEmail, c.verifyTls]))
    .digest("hex");
}

function rememberTest(key: string, test: { at: string; ok: boolean; error?: string; to?: string }) {
  const now = Date.now();
  for (const [k, v] of recentTests) if (v.expires < now) recentTests.delete(k);
  if (recentTests.size > 500) recentTests.clear();
  recentTests.set(key, { ...test, expires: now + TEST_MEMORY_MS });
}

/** Valida y guarda. Si no llega contraseña, conserva la anterior (si el servidor y usuario no cambiaron). */
export async function saveMail(scope: MailScope, input: MailInput, actorId: string): Promise<StoredMail> {
  await resolveTarget(scope, input.host, input.port);
  const current = await getMail(scope);
  const username = input.username || null;
  const keepPassword = !input.password && current?.passwordEnc && current.host === input.host && current.username === username;
  if (username && !input.password && !keepPassword) {
    throw new HttpError(400, "Ingresa la contraseña del usuario SMTP.", "password_required");
  }
  const password = username ? input.password || decryptSetting(current!.passwordEnc!) : null;
  const tested = recentTests.get(
    fingerprint(scope, { host: input.host, port: input.port, security: input.security, username, password, fromEmail: input.fromEmail, verifyTls: input.verifyTls }),
  );
  const value: StoredMail = {
    host: input.host,
    port: input.port,
    security: input.security,
    username,
    passwordEnc: username ? (input.password ? encryptSetting(input.password) : current!.passwordEnc) : null,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo ?? null,
    verifyTls: input.verifyTls,
    updatedAt: new Date().toISOString(),
    // Si esta configuración exacta se acaba de probar, se conserva el resultado.
    lastTest: tested && tested.expires > Date.now() ? { at: tested.at, ok: tested.ok, to: tested.to, ...(tested.error ? { error: tested.error } : {}) } : undefined,
    lastFailure: null,
  };
  await writeMail(scope, value, actorId);
  return value;
}

/* ------------------------------------------------------------------ Conexión y envío */

export interface SmtpConnection {
  host: string;
  port: number;
  security: MailSecurity;
  username: string | null;
  password: string | null;
  verifyTls: boolean;
}

async function buildTransport(scope: MailScope, c: SmtpConnection) {
  const target = await resolveTarget(scope, c.host, c.port);
  const options: SMTPTransport.Options = {
    host: target,
    port: c.port,
    secure: c.security === "tls",
    requireTLS: c.security === "starttls",
    ignoreTLS: c.security === "none",
    auth: c.username ? { user: c.username, pass: c.password ?? "" } : undefined,
    // Se conecta a la IP validada, pero el certificado se verifica contra el nombre del servidor.
    tls: { rejectUnauthorized: c.verifyTls, servername: isIP(c.host) ? undefined : c.host },
    name: new URL(config.appUrl).hostname,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
  return nodemailer.createTransport(options);
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Sender {
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
}

export async function sendWith(scope: MailScope, c: SmtpConnection, sender: Sender, mail: OutgoingMail) {
  const transport = await buildTransport(scope, c);
  try {
    await transport.sendMail({
      from: { name: sender.fromName, address: sender.fromEmail },
      replyTo: sender.replyTo || undefined,
      ...mail,
    });
  } finally {
    transport.close();
  }
}

export const connectionOf = (m: StoredMail): SmtpConnection => ({
  host: m.host,
  port: m.port,
  security: m.security,
  username: m.username,
  password: m.passwordEnc ? decryptSetting(m.passwordEnc) : null,
  verifyTls: m.verifyTls,
});

/** Traduce los errores de SMTP a algo que el administrador pueda corregir. */
export function describeSmtpError(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const detail = (e.response ?? e.message ?? "").replace(/\s+/g, " ").slice(0, 200);
  const cert = /certificate|self[- ]signed|CERT_|unable to verify/i;
  if (e.code === "EAUTH") return `El servidor rechazó el usuario o la contraseña. ${detail}`;
  if (cert.test(detail) || cert.test(e.code ?? "")) {
    return "El certificado del servidor no es válido. Si es un servidor interno con certificado propio, desactiva «Verificar certificado».";
  }
  if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION" || e.code === "ESOCKET" || e.code === "ECONNREFUSED") {
    return `No se pudo conectar al servidor. Revisa el servidor, el puerto y el tipo de seguridad. ${detail}`;
  }
  if (e.code === "EENVELOPE" || (e.responseCode && e.responseCode >= 500)) {
    return `El servidor rechazó el envío (revisa que el remitente esté autorizado en esa cuenta). ${detail}`;
  }
  return detail || "Error desconocido al enviar el correo.";
}

/**
 * Prueba una configuración (la del formulario, aunque no esté guardada) enviando un correo real.
 * Si coincide con la guardada, deja registrado el resultado.
 */
export async function testMail(scope: MailScope, input: MailInput, to: string, organization: string) {
  const current = await getMail(scope);
  const username = input.username || null;
  const password =
    input.password || (current?.passwordEnc && current.host === input.host && current.username === username ? decryptSetting(current.passwordEnc) : null);
  if (username && !password) throw new HttpError(400, "Ingresa la contraseña para probar.", "password_required");

  let result: { ok: true } | { ok: false; error: string };
  try {
    await sendWith(
      scope,
      { host: input.host, port: input.port, security: input.security, username, password, verifyTls: input.verifyTls },
      { fromName: input.fromName, fromEmail: input.fromEmail, replyTo: input.replyTo },
      {
        to,
        subject: "Prueba de correo del Canal de Denuncias",
        text: `Este es un correo de prueba de ${organization}. Si lo recibiste, la configuración SMTP funciona.\n\nServidor: ${input.host}:${input.port}`,
        html: layout({
          organization,
          title: "La configuración de correo funciona",
          paragraphs: [
            "Este es un correo de prueba enviado desde el Canal de Denuncias.",
            `Servidor: ${input.host}:${input.port} (${input.security === "tls" ? "SSL/TLS" : input.security === "starttls" ? "STARTTLS" : "sin cifrado"}).`,
          ],
          footer: "Puedes eliminar este correo.",
        }),
      },
    );
    result = { ok: true };
  } catch (err) {
    result = { ok: false, error: describeSmtpError(err) };
  }

  const lastTest = { at: new Date().toISOString(), ok: result.ok, to, ...(result.ok ? {} : { error: result.error }) };
  rememberTest(
    fingerprint(scope, { host: input.host, port: input.port, security: input.security, username, password, fromEmail: input.fromEmail, verifyTls: input.verifyTls }),
    lastTest,
  );

  const matchesSaved =
    current &&
    current.host === input.host &&
    current.port === input.port &&
    current.security === input.security &&
    current.username === username &&
    current.fromEmail === input.fromEmail &&
    current.verifyTls === input.verifyTls &&
    !input.password;
  if (matchesSaved) {
    await patchStatus(scope, {
      lastTest,
      ...(result.ok ? { lastFailure: null } : {}),
    });
  }
  return result;
}

export async function recordFailure(scope: MailScope, error: string) {
  await patchStatus(scope, { lastFailure: { at: new Date().toISOString(), error } }).catch(() => {});
}

export async function clearFailure(scope: MailScope) {
  await patchStatus(scope, { lastFailure: null }).catch(() => {});
}
