import type { ChannelUser } from "./channel.js";

/**
 * Detección de conflicto de interés al recibir una denuncia: se comparan los nombres que escribe el denunciante
 * (personas involucradas y, si la indica, la persona del área que recibe denuncias) con los usuarios del canal. Quien
 * coincida queda excluido del caso desde que se crea, antes de que nadie pueda verlo.
 *
 * Criterio: al menos dos palabras del nombre escrito (sin tildes ni mayúsculas) y todas presentes en el nombre del
 * usuario («Ana Pérez» coincide con «Ana María Pérez Soto»), o el correo exacto. Una sola palabra no basta, para no
 * excluir a medio equipo por un nombre común. Un falso positivo solo oculta el caso a esa persona: el gestor lo
 * revisa y puede revertirlo con un motivo.
 */

const STOPWORDS = new Set(["de", "del", "la", "las", "los", "y", "don", "dona", "sr", "sra", "srta"]);

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/** Usuarios del canal que coinciden con un texto (nombre o correo). */
export function matchUsers(users: readonly ChannelUser[], text: string): ChannelUser[] {
  const emails = (text.match(EMAIL) ?? []).map((e) => e.toLowerCase());
  const given = words(text.replace(EMAIL, " "));
  return users.filter((u) => {
    if (emails.includes(u.email.toLowerCase())) return true;
    if (given.length < 2) return false;
    const own = new Set(words(u.name));
    return given.every((w) => own.has(w));
  });
}

/** Resultado de revisar los nombres de una denuncia nueva. */
export interface ConflictCheck {
  /** Usuarios que quedan excluidos. */
  userIds: string[];
  /** Nombre que el denunciante indicó como parte del equipo y que no coincide con ningún usuario (para revisión). */
  unmatchedTeamName: string | null;
}

export function detectConflicts(
  users: readonly ChannelUser[],
  involvedNames: readonly string[],
  teamName: string | null | undefined,
): ConflictCheck {
  const ids = new Set<string>();
  for (const name of involvedNames) for (const u of matchUsers(users, name)) ids.add(u.id);
  let unmatchedTeamName: string | null = null;
  if (teamName?.trim()) {
    const found = matchUsers(users, teamName);
    for (const u of found) ids.add(u.id);
    if (!found.length) unmatchedTeamName = teamName.trim();
  }
  return { userIds: [...ids], unmatchedTeamName };
}
