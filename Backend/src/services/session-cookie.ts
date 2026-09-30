import type { Request, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "../errors.js";

/**
 * Sesión del equipo en una cookie HttpOnly: el JavaScript de la página no puede leerla, así que ni una falla XSS
 * permitiría robar la sesión. Hay una cookie por ámbito y cada una solo viaja a su parte de la API:
 *   consola      → cd_admin        (Path=/api/admin)
 *   cada empresa → cd_t_<slug>     (Path=/api/t/<slug>)
 * SameSite=Strict + la verificación de origen (checkSameOrigin) evitan que otro sitio la use (CSRF).
 *
 * Integraciones y scripts pueden seguir usando «Authorization: Bearer»: si piden el login con el encabezado
 * «X-Session-Mode: bearer», la respuesta incluye el token en vez del marcador.
 */

/** Lo que recibe el navegador en lugar del token: solo indica que hay sesión (no es un secreto). */
export const SESSION_MARKER = "cookie";

const cookieFor = (tenantSlug?: string) =>
  tenantSlug ? { name: `cd_t_${tenantSlug}`, path: `/api/t/${tenantSlug}` } : { name: "cd_admin", path: "/api/admin" };

const baseOptions = (path: string) => ({ httpOnly: true, sameSite: "strict" as const, secure: config.cookieSecure, path });

/** Guarda la sesión en la cookie y devuelve lo que va en el campo `token` de la respuesta. */
export function issueSession(req: Request, res: Response, token: string, tenantSlug?: string): string {
  const { name, path } = cookieFor(tenantSlug);
  const exp = (JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as { exp: number }).exp;
  res.cookie(name, token, { ...baseOptions(path), maxAge: Math.max(0, exp * 1000 - Date.now()) });
  return req.get("x-session-mode") === "bearer" ? token : SESSION_MARKER;
}

export function clearSession(res: Response, tenantSlug?: string) {
  const { name, path } = cookieFor(tenantSlug);
  res.clearCookie(name, baseOptions(path));
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Token de la petición: primero «Authorization: Bearer» (integraciones), si no, la cookie de su ámbito. */
export function requestToken(req: Request): { token: string; via: "bearer" | "cookie" } | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token && token !== SESSION_MARKER) return { token, via: "bearer" };
  }
  const cookie = readCookie(req, cookieFor(req.tenant?.slug).name);
  return cookie ? { token: cookie, via: "cookie" } : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protección CSRF para las peticiones autenticadas con cookie que modifican algo: el navegador siempre envía
 * «Origin» en ellas y otro sitio no puede falsificarlo. Se acepta si es la misma dirección a la que se conectó
 * el navegador, APP_URL o uno de CORS_ORIGIN.
 */
export function checkSameOrigin(req: Request) {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.get("origin");
  if (!origin) throw new HttpError(403, "Solicitud rechazada: falta el origen.", "csrf");
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Solicitud rechazada: origen inválido.", "csrf");
  }
  const requestHost = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0]!.trim();
  const allowed = [config.appUrl, ...config.corsOrigin.split(",")].map((o) => o.trim().replace(/\/+$/, ""));
  if (host !== requestHost && !allowed.includes(origin.replace(/\/+$/, ""))) {
    throw new HttpError(403, "Solicitud rechazada: origen no permitido.", "csrf");
  }
}
