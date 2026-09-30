/**
 * Sesiones separadas por ámbito: la del global_admin y una por cada empresa.
 * Así una sesión de una empresa no se mezcla con la de otra ni con la del admin global.
 *
 * La sesión real va en una cookie HttpOnly que pone el backend (el JavaScript no puede leerla, así que una falla
 * XSS no podría robarla). Aquí solo se guarda un marcador ("cookie") para saber que hay una sesión abierta.
 */
export type SessionScope = { kind: "global" } | { kind: "tenant"; slug: string };

/** Valor que entrega el backend en lugar del token (coincide con SESSION_MARKER del backend). */
export const SESSION_MARKER = "cookie";

const keyFor = (scope: SessionScope) =>
  scope.kind === "global" ? "cd.token.global" : `cd.token.tenant.${scope.slug}`;
const apiFor = (scope: SessionScope) => (scope.kind === "global" ? "/api/admin" : `/api/t/${scope.slug}`);

export function getToken(scope: SessionScope): string | null {
  try {
    const value = localStorage.getItem(keyFor(scope));
    // Versiones anteriores guardaban aquí el token real: se borra y se pide volver a ingresar.
    if (value && value !== SESSION_MARKER) {
      localStorage.removeItem(keyFor(scope));
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function setToken(scope: SessionScope, token: string): void {
  try {
    // Nunca se guarda un token real, solo el marcador.
    localStorage.setItem(keyFor(scope), token === SESSION_MARKER ? token : SESSION_MARKER);
  } catch {
    // Sin almacenamiento disponible la sesión dura solo mientras la pestaña esté abierta.
  }
}

/** Cierra la sesión: borra el marcador y le pide al backend que borre la cookie. */
export function clearToken(scope: SessionScope): void {
  try {
    localStorage.removeItem(keyFor(scope));
  } catch {
    // nada que limpiar
  }
  void fetch(`${apiFor(scope)}/auth/logout`, { method: "POST", keepalive: true }).catch(() => {});
}

export const GLOBAL_SCOPE: SessionScope = { kind: "global" };
export const tenantScope = (slug: string): SessionScope => ({ kind: "tenant", slug });
