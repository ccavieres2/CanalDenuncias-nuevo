import nodemailer from "nodemailer";
import { config } from "../config.js";
import {
  type MailScope,
  type OutgoingMail,
  clearFailure,
  connectionOf,
  describeSmtpError,
  getMail,
  recordFailure,
  sendWith,
} from "./mail-settings.js";
import type { Tenant } from "./tenants.js";

export { layout } from "./mail-template.js";

/**
 * Envío de correos. Se intenta, en orden, con:
 *   1. El SMTP propio de la empresa (si el correo es de una empresa y lo configuró su client_admin).
 *   2. El SMTP de la plataforma (configurado en la consola BeeHives → «Correo saliente»).
 *   3. El SMTP del .env (SMTP_HOST…). En desarrollo es Mailpit: http://localhost:8025.
 * Si uno falla se usa el siguiente, para que un SMTP mal configurado no deje a nadie sin su código de recuperación.
 * La falla queda registrada y se muestra en la pantalla de configuración de ese SMTP.
 */

const envTransport = config.mail.host
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

export type Mail = OutgoingMail;

export interface MailContext {
  /** Empresa a la que pertenece el correo (usa su SMTP si tiene). */
  tenant?: Tenant;
  /** Nombre que se muestra como remitente cuando se usa un SMTP de respaldo. */
  organization: string;
}

/** De dónde salió el correo (para registro y pruebas). */
export type MailRoute = "tenant" | "platform" | "env";

export async function sendMail(mail: Mail, ctx: MailContext): Promise<MailRoute | null> {
  let lastError: unknown = null;

  if (ctx.tenant) {
    const scope: MailScope = { kind: "tenant", tenant: ctx.tenant };
    const own = await getMail(scope);
    if (own) {
      try {
        await sendWith(scope, connectionOf(own), own, mail);
        if (own.lastFailure) await clearFailure(scope);
        return "tenant";
      } catch (err) {
        lastError = err;
        console.warn(`[correo] falló el SMTP de ${ctx.tenant.slug}; se usa el de respaldo: ${describeSmtpError(err)}`);
        await recordFailure(scope, describeSmtpError(err));
      }
    }
  }

  const platformScope: MailScope = { kind: "platform" };
  const platform = await getMail(platformScope);
  if (platform) {
    try {
      // Correos de una empresa por el SMTP de la plataforma: el nombre visible es el de la empresa.
      const sender = ctx.tenant ? { ...platform, fromName: `${ctx.organization} · Canal de Denuncias`, replyTo: null } : platform;
      await sendWith(platformScope, connectionOf(platform), sender, mail);
      if (platform.lastFailure) await clearFailure(platformScope);
      return "platform";
    } catch (err) {
      lastError = err;
      console.warn(`[correo] falló el SMTP de la plataforma; se usa el del .env: ${describeSmtpError(err)}`);
      await recordFailure(platformScope, describeSmtpError(err));
    }
  }

  if (envTransport) {
    const from = ctx.tenant ? { name: `${ctx.organization} · Canal de Denuncias`, address: envAddress() } : config.mail.from;
    await envTransport.sendMail({ from, ...mail });
    return "env";
  }

  if (lastError) throw lastError;
  console.warn(`[correo] no hay ningún SMTP configurado; no se envió «${mail.subject}»`);
  return null;
}

/** Dirección de MAIL_FROM («Nombre <correo>» o solo el correo). */
function envAddress(): string {
  const m = /<([^>]+)>/.exec(config.mail.from);
  return (m ? m[1]! : config.mail.from).trim();
}

/** Qué SMTP de respaldo tiene la plataforma (para mostrarlo en las pantallas de configuración). */
export async function fallbackStatus(): Promise<{ platform: boolean; env: boolean }> {
  return { platform: !!(await getMail({ kind: "platform" })), env: envTransport !== null };
}
