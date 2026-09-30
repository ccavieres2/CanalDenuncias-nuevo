import { SESSION_MARKER } from "./session";

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  /** Código estable enviado por el backend (p. ej. "mfa_expired"). */
  code?: string;

  constructor(status: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /**
   * Sesión del equipo: es el marcador "cookie" (la sesión real viaja sola en una cookie HttpOnly).
   * Para el denunciante es su token de seguimiento, que se envía como Bearer y solo vive en memoria.
   */
  token?: string | null;
}

/** Llama a la API (Vite hace proxy de /api al backend). */
export async function api<T>(path: string, { method = "GET", body, token }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token && token !== SESSION_MARKER) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Error inesperado", data.fields, data.code);
  return data as T;
}
