import { config } from "../config.js";
import { layout, sendMail } from "./mail.js";
import type { Tenant } from "./tenants.js";

/**
 * Avisos por correo de lo que pasa en el canal (denuncia nueva, asignación, mensaje del denunciante, cierre por
 * aprobar) y de las credenciales de una cuenta. Los avisos de denuncias llevan solo el código y el enlace: nunca el
 * relato ni nombres, porque el correo puede quedar en bandejas compartidas o reenviarse.
 *
 * Nunca bloquean ni hacen fallar la acción que los origina: si el correo falla, queda en el registro del backend.
 */

export interface Recipient {
  email: string;
  name: string;
}

export interface Notice {
  subject: string;
  title: string;
  paragraphs: string[];
  /** Ruta dentro de la app (p. ej. /empresa/cases/…). */
  path: string;
  footer?: string;
}

const DEFAULT_FOOTER = "Este aviso no incluye el contenido de la denuncia. Ingresa al canal para revisarla.";

/** Envía el aviso a cada persona por separado (nadie ve a los demás destinatarios). */
export async function notify(tenant: Tenant, recipients: Recipient[], notice: Notice): Promise<void> {
  const link = `${config.appUrl}${notice.path}`;
  const unique = [...new Map(recipients.map((r) => [r.email.toLowerCase(), r])).values()];
  for (const r of unique) {
    const paragraphs = [`Hola ${r.name}:`, ...notice.paragraphs, `Ingresa aquí: ${link}`];
    try {
      const route = await sendMail(
        {
          to: r.email,
          subject: notice.subject,
          text: paragraphs.join("\n\n"),
          html: layout({ organization: tenant.name, title: notice.title, paragraphs, footer: notice.footer ?? DEFAULT_FOOTER }),
        },
        { tenant, organization: tenant.name },
      );
      // Sin ningún SMTP configurado no tiene sentido seguir con los demás destinatarios.
      if (!route) return;
    } catch (err) {
      console.error(`[avisos] no se pudo enviar «${notice.title}» a un usuario de ${tenant.slug}:`, err);
    }
  }
}

/** Lanza el aviso sin esperar: la respuesta al usuario no depende del correo. */
export function notifyLater(task: () => Promise<void>): void {
  task().catch((err) => console.error("[avisos] falló la preparación de un aviso:", err));
}

/**
 * Correo con la contraseña temporal de una cuenta nueva o restablecida. La contraseña sirve una sola vez: al ingresar,
 * el sistema obliga a cambiarla. Quien la creó también la ve en pantalla, por si el correo no llega.
 */
export async function sendCredentials(
  ctx: { tenant?: Tenant; organization: string },
  to: Recipient,
  temporaryPassword: string,
  loginPath: string,
  reason: "created" | "reset",
): Promise<boolean> {
  const link = `${config.appUrl}${loginPath}`;
  const title = reason === "created" ? "Tu cuenta en el canal de denuncias" : "Tu contraseña fue restablecida";
  const paragraphs = [
    `Hola ${to.name}:`,
    reason === "created"
      ? `Se creó tu cuenta en el canal de denuncias de ${ctx.organization}.`
      : `Un administrador restableció tu contraseña del canal de denuncias de ${ctx.organization}.`,
    `Usuario: ${to.email}`,
    `Contraseña temporal: ${temporaryPassword}`,
    "Al ingresar deberás cambiarla y configurar la verificación en dos pasos.",
    `Ingresa aquí: ${link}`,
  ];
  try {
    const route = await sendMail(
      {
        to: to.email,
        subject: title,
        text: paragraphs.join("\n\n"),
        html: layout({
          organization: ctx.organization,
          title,
          paragraphs,
          footer: "Si no esperabas este correo, avisa al administrador del canal. Nunca te pediremos esta contraseña por teléfono ni por correo.",
        }),
      },
      ctx,
    );
    return route !== null;
  } catch (err) {
    console.error("[avisos] no se pudo enviar la contraseña temporal:", err);
    return false;
  }
}
