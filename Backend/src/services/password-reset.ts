import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import { type Account, type AccountStore, findAccount, findAccountByEmail, setPassword } from "./accounts.js";
import { hashPassword, signResetToken, verifyPassword, verifyResetToken } from "./auth.js";
import { layout, sendMail } from "./mail.js";
import type { Tenant } from "./tenants.js";

/**
 * Recuperación de contraseña por correo, igual para el equipo BeeHives y para cada empresa:
 *   1. La persona pide un código con su correo. Si la cuenta existe y está activa, llega un código de 6 dígitos
 *      que vence en 15 minutos. La respuesta es siempre la misma, exista o no la cuenta.
 *   2. Ingresa el código (máximo 5 intentos por código) y recibe un token de 10 minutos.
 *   3. Elige la contraseña nueva. Se cierran sus sesiones anteriores y se le avisa por correo.
 * El doble factor NO cambia: para entrar sigue pidiendo el código de la app de autenticación.
 */

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
/** Espera mínima entre dos solicitudes de la misma cuenta, y máximo por hora. */
const RESEND_SECONDS = 60;
const MAX_PER_HOUR = 5;

const INVALID = () => new HttpError(400, "El código no es válido o ya venció. Revísalo o pide uno nuevo.", "invalid_code");
const EXPIRED = () => new HttpError(400, "La solicitud venció. Vuelve a pedir un código.", "reset_expired");

/** Solo se guarda el HMAC del código, amarrado a la solicitud. */
const hashCode = (resetId: string, code: string) =>
  createHmac("sha256", config.jwtSecret).update(`password-reset:${resetId}:${code}`).digest("hex");

interface ResetRow {
  id: string;
  code_hash: string;
  attempts: number;
}

export interface ResetContext {
  store: AccountStore;
  /** Empresa (sus correos salen por su SMTP si tiene uno); sin ella, es la consola de la plataforma. */
  tenant?: Tenant;
  /** Nombre que aparece en el correo (la empresa o «Consola de administración»). */
  organization: string;
  /** Página de ingreso de ese ámbito, para el enlace del correo. */
  loginPath: string;
}

/**
 * Paso 1. Devuelve la cuenta si se envió un código (para la auditoría), o null si no existe, está inactiva o
 * pidió demasiados. Quien llama no debe revelar la diferencia.
 */
export async function requestPasswordReset(ctx: ResetContext, email: string): Promise<Account | null> {
  const { store } = ctx;
  const account = await findAccountByEmail(store, email);
  if (!account) return null;

  const recent = await store.pool.query<{ last: Date | null; hour: string }>(
    `SELECT max(created_at) AS last, count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS hour
     FROM password_resets WHERE account_id = $1`,
    [account.id],
  );
  const { last, hour } = recent.rows[0]!;
  if ((last && Date.now() - new Date(last).getTime() < RESEND_SECONDS * 1000) || Number(hour) >= MAX_PER_HOUR) return null;

  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Un código nuevo anula los anteriores.
  await store.pool.query("UPDATE password_resets SET used_at = now() WHERE account_id = $1 AND used_at IS NULL", [account.id]);
  await store.pool.query(
    `INSERT INTO password_resets (id, account_id, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [id, account.id, hashCode(id, code), CODE_TTL_MINUTES],
  );

  await sendMail({
    to: account.email,
    subject: `${code} es tu código para recuperar la contraseña`,
    text: [
      `Hola ${account.name}:`,
      `Recibimos una solicitud para restablecer la contraseña de tu cuenta en ${ctx.organization}.`,
      `Tu código es: ${code}`,
      `Vence en ${CODE_TTL_MINUTES} minutos. Si no fuiste tú, ignora este correo: tu contraseña no cambiará.`,
    ].join("\n\n"),
    html: layout({
      organization: ctx.organization,
      title: "Recupera tu contraseña",
      paragraphs: [
        `Hola ${account.name}:`,
        "Recibimos una solicitud para restablecer la contraseña de tu cuenta. Ingresa este código en la página de ingreso:",
      ],
      code,
      footer: `El código vence en ${CODE_TTL_MINUTES} minutos y solo se puede usar una vez. Si no fuiste tú, ignora este correo: tu contraseña no cambiará. Nunca te pediremos este código por teléfono.`,
    }),
  }, { tenant: ctx.tenant, organization: ctx.organization });
  return account;
}

/** Paso 2. Valida el código y entrega el token para elegir la contraseña nueva. */
export async function verifyResetCode(store: AccountStore, scope: string, email: string, code: string) {
  const account = await findAccountByEmail(store, email);
  const res = account
    ? await store.pool.query<ResetRow>(
        `SELECT id, code_hash, attempts FROM password_resets
         WHERE account_id = $1 AND used_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1`,
        [account.id],
      )
    : null;
  const row = res?.rows[0];
  // Se calcula igual aunque no haya solicitud, para que la respuesta tarde lo mismo.
  const given = Buffer.from(hashCode(row?.id ?? "none", code));
  if (!account || !row) throw INVALID();

  if (!timingSafeEqual(given, Buffer.from(row.code_hash))) {
    const upd = await store.pool.query<{ attempts: number }>(
      `UPDATE password_resets SET attempts = attempts + 1,
         used_at = CASE WHEN attempts + 1 >= $2 THEN now() END
       WHERE id = $1 RETURNING attempts`,
      [row.id, MAX_ATTEMPTS],
    );
    if (upd.rows[0]!.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(400, "Demasiados intentos con este código. Pide uno nuevo.", "too_many_attempts");
    }
    throw INVALID();
  }

  await store.pool.query("UPDATE password_resets SET verified_at = now() WHERE id = $1", [row.id]);
  return { account, resetToken: signResetToken({ sub: account.id, rid: row.id, scope }) };
}

/** Paso 3. Guarda la contraseña nueva, anula la solicitud y avisa por correo. */
export async function completePasswordReset(ctx: ResetContext, scope: string, resetToken: string, newPassword: string) {
  const { store } = ctx;
  const payload = verifyResetToken(resetToken, scope);
  if (!payload) throw EXPIRED();
  const account = await findAccount(store, payload.sub);
  if (!account?.is_active) throw EXPIRED();
  if (await verifyPassword(newPassword, account.password_hash)) {
    throw new HttpError(400, "La nueva contraseña debe ser distinta de la anterior", "same_password");
  }

  const used = await store.pool.query(
    `UPDATE password_resets SET used_at = now()
     WHERE id = $1 AND account_id = $2 AND verified_at IS NOT NULL AND used_at IS NULL AND expires_at > now()`,
    [payload.rid, account.id],
  );
  if (!used.rowCount) throw EXPIRED();

  // Deja de ser temporal: la eligió la persona. Las sesiones anteriores quedan cerradas.
  await setPassword(store, account.id, await hashPassword(newPassword), false);

  const when = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short", timeZone: "America/Santiago" }).format(
    new Date(),
  );
  await sendMail({
    to: account.email,
    subject: "Tu contraseña fue cambiada",
    text: `Hola ${account.name}:\n\nLa contraseña de tu cuenta en ${ctx.organization} se cambió el ${when}.\n\nSi no fuiste tú, avisa de inmediato a tu administrador.\n\n${config.appUrl}${ctx.loginPath}`,
    html: layout({
      organization: ctx.organization,
      title: "Tu contraseña fue cambiada",
      paragraphs: [
        `Hola ${account.name}:`,
        `La contraseña de tu cuenta se cambió el ${when} usando un código enviado a este correo. Para ingresar sigue siendo necesaria tu app de autenticación.`,
      ],
      footer: "Si no fuiste tú, avisa de inmediato a tu administrador para que bloquee la cuenta.",
    }),
  }, { tenant: ctx.tenant, organization: ctx.organization }).catch((err) => console.warn(`[correo] no se pudo avisar el cambio de contraseña: ${(err as Error).message}`));
  return account;
}
