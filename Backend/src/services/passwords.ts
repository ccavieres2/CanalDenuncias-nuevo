import { randomInt } from "node:crypto";
import { z } from "zod";

/** Política de contraseñas elegidas por el usuario. */
export const passwordSchema = z
  .string()
  .min(10, "Mínimo 10 caracteres")
  .max(200, "Máximo 200 caracteres")
  .regex(/[A-Za-zÀ-ÿ]/, "Debe incluir al menos una letra")
  .regex(/\d/, "Debe incluir al menos un número");

// Sin caracteres que se confunden al dictarlos o copiarlos a mano (0/O, 1/l/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Contraseña temporal para cuentas creadas o reseteadas por un administrador,
 * con formato fácil de transcribir: "Xk7m-Qp3r-Tz9w". Siempre cumple la política.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const candidate = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
    if (passwordSchema.safeParse(candidate).success) return candidate;
  }
}
