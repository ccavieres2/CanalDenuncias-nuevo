import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Código estable para que el frontend reaccione sin depender del texto. */
    public code?: string,
  ) {
    super(message);
  }
}

/** Código de PostgreSQL para violación de UNIQUE. */
export const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Datos inválidos",
      fields: Object.fromEntries(err.issues.map((i) => [i.path.join("."), i.message])),
    });
    return;
  }
  // Errores del lector de JSON: cuerpo demasiado grande o mal formado. Son errores del cliente, no del servidor.
  const bodyError = (err as { type?: string })?.type;
  if (bodyError === "entity.too.large") {
    res.status(413).json({ error: "La solicitud es demasiado grande." });
    return;
  }
  if (bodyError === "entity.parse.failed") {
    res.status(400).json({ error: "El contenido enviado no es válido." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
};
