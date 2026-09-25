import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { HttpError } from "../errors.js";
import { type Account, type AccountStore, findAccountById } from "./accounts.js";
import { decryptSecret, encryptSecret, sha256 } from "./secrets.js";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp.js";

const RECOVERY_CODE_COUNT = 8;
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // sin caracteres ambiguos (0/o, 1/l/i)

/**
 * Genera (o reutiliza, si ya había uno pendiente) el secreto TOTP y devuelve
 * lo necesario para mostrar el QR. Solo se permite si el 2FA aún no está activo:
 * así, alguien que robe una contraseña no puede registrar su propio teléfono.
 */
export async function beginTotpSetup(store: AccountStore, account: Account) {
  if (account.totp_enabled_at) throw new HttpError(409, "El doble factor ya está configurado");

  let stored = account.totp_secret;
  if (!stored) {
    // Solo guarda si nadie lo hizo antes; si dos requests llegan juntas, ambas terminan
    // con el mismo secreto (el QR mostrado siempre coincide con el guardado).
    await store.pool.query(`UPDATE ${store.table} SET totp_secret = $2 WHERE id = $1 AND totp_secret IS NULL`, [
      account.id,
      encryptSecret(generateTotpSecret()),
    ]);
    stored = (await findAccountById(store, account.id)).totp_secret!;
  }
  const secret = decryptSecret(stored);

  const url = otpauthUrl(secret, store.issuer, account.email);
  return {
    secret,
    otpauthUrl: url,
    qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }),
  };
}

/** Confirma el primer código, activa el 2FA y entrega los códigos de recuperación (una sola vez). */
export async function completeTotpSetup(store: AccountStore, account: Account, code: string): Promise<string[]> {
  if (account.totp_enabled_at) throw new HttpError(409, "El doble factor ya está configurado");
  if (!account.totp_secret) throw new HttpError(400, "Primero genera el código QR");

  const step = verifyTotp(decryptSecret(account.totp_secret), code, null);
  if (step === null) throw new HttpError(401, "Código incorrecto. Revisa la hora de tu teléfono e inténtalo otra vez.");

  const codes = newRecoveryCodes();
  const res = await store.pool.query(
    `UPDATE ${store.table}
     SET totp_enabled_at = now(), totp_last_step = $2, recovery_codes = $3
     WHERE id = $1 AND totp_enabled_at IS NULL`,
    [account.id, step, codes.map(hashRecoveryCode)],
  );
  if (!res.rowCount) throw new HttpError(409, "El doble factor ya está configurado");
  return codes;
}

/**
 * Verifica el segundo factor en un login normal. Acepta el código de la app o,
 * si el usuario perdió el teléfono, un código de recuperación (que se consume).
 */
export async function verifySecondFactor(
  store: AccountStore,
  account: Account,
  code: string,
): Promise<"totp" | "recovery_code"> {
  if (!account.totp_enabled_at || !account.totp_secret) throw new HttpError(400, "El doble factor no está configurado");

  const normalized = code.trim().replace(/\s/g, "");
  if (/^\d{6}$/.test(normalized)) {
    const lastStep = account.totp_last_step === null ? null : Number(account.totp_last_step);
    const step = verifyTotp(decryptSecret(account.totp_secret), normalized, lastStep);
    if (step !== null) {
      // Condicional: si llegan dos requests con el mismo código a la vez, solo una lo "consume".
      const res = await store.pool.query(
        `UPDATE ${store.table} SET totp_last_step = $2
         WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
        [account.id, step],
      );
      if (res.rowCount) return "totp";
    }
  } else {
    const res = await store.pool.query(
      `UPDATE ${store.table} SET recovery_codes = array_remove(recovery_codes, $2)
       WHERE id = $1 AND $2 = ANY(recovery_codes)`,
      [account.id, hashRecoveryCode(normalized)],
    );
    if (res.rowCount) return "recovery_code";
  }
  throw new HttpError(401, "Código incorrecto");
}

/**
 * Genera un juego nuevo de códigos de recuperación (invalida los anteriores).
 * Exige un código vigente de la app, para que una sesión robada no pueda hacerlo.
 */
export async function regenerateRecoveryCodes(store: AccountStore, account: Account, code: string): Promise<string[]> {
  if (!account.totp_enabled_at || !account.totp_secret) throw new HttpError(400, "El doble factor no está configurado");
  if (!/^\d{6}$/.test(code.trim())) throw new HttpError(400, "Ingresa el código de 6 dígitos de tu app");
  await verifySecondFactor(store, account, code);

  const codes = newRecoveryCodes();
  await store.pool.query(`UPDATE ${store.table} SET recovery_codes = $2 WHERE id = $1`, [
    account.id,
    codes.map(hashRecoveryCode),
  ]);
  return codes;
}

/** Borra el 2FA de una cuenta: en su próximo login tendrá que configurarlo de nuevo. */
export async function resetMfa(store: AccountStore, accountId: string): Promise<boolean> {
  const res = await store.pool.query(
    `UPDATE ${store.table}
     SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = '{}'
     WHERE id = $1`,
    [accountId],
  );
  return (res.rowCount ?? 0) > 0;
}

const newRecoveryCodes = () => Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);

function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

const hashRecoveryCode = (code: string) => sha256(code.toLowerCase().replace(/[^a-z0-9]/g, ""));
