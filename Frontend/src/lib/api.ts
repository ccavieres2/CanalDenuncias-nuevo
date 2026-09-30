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

/** Sube un archivo como cuerpo binario; la sesión del denunciante y el nombre van en cabeceras. */
export async function uploadFile<T>(path: string, file: File, session: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Reporter-Session": session,
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = res.status === 413 ? "El archivo supera el máximo de 10 MB." : (data.error ?? "Error inesperado");
    throw new ApiError(res.status, message, data.fields, data.code);
  }
  return data as T;
}

/** Descarga un archivo protegido (con la sesión del equipo) y lo guarda con el nombre indicado. */
export async function downloadFile(path: string, fileName: string, token?: string | null): Promise<void> {
  const headers: Record<string, string> = {};
  if (token && token !== SESSION_MARKER) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers });
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? "Error inesperado", data.fields, data.code);
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Se libera después para que el navegador alcance a iniciar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
