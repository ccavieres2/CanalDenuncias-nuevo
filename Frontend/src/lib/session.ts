/**
 * Tokens separados por ámbito: el del global_admin y uno por cada empresa.
 * Así una sesión de una empresa no se mezcla con la de otra ni con la del admin global.
 */
export type SessionScope = { kind: "global" } | { kind: "tenant"; slug: string };

const keyFor = (scope: SessionScope) =>
  scope.kind === "global" ? "cd.token.global" : `cd.token.tenant.${scope.slug}`;

export function getToken(scope: SessionScope): string | null {
  try {
    return localStorage.getItem(keyFor(scope));
  } catch {
    return null;
  }
}

export function setToken(scope: SessionScope, token: string): void {
  try {
    localStorage.setItem(keyFor(scope), token);
  } catch {
    // Sin almacenamiento disponible la sesión dura solo mientras la pestaña esté abierta.
  }
}

export function clearToken(scope: SessionScope): void {
  try {
    localStorage.removeItem(keyFor(scope));
  } catch {
    // nada que limpiar
  }
}

export const GLOBAL_SCOPE: SessionScope = { kind: "global" };
export const tenantScope = (slug: string): SessionScope => ({ kind: "tenant", slug });
