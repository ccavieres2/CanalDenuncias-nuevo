import { type Request, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { type AuditInput, audit } from "../services/audit.js";
import { fallbackStatus } from "../services/mail.js";
import { type MailScope, getMail, mailInputSchema, publicMail, removeMail, saveMail, testMail } from "../services/mail-settings.js";

interface MailRouterOptions {
  scope: (req: Request) => MailScope;
  /** Nombre que aparece en el correo de prueba. */
  organization: (req: Request) => string;
  /** Slug de la empresa para la auditoría (ausente en la plataforma). */
  tenantSlug?: (req: Request) => string;
}

// Cada prueba envía un correo real: se limita para que no sirva para enviar spam.
const testLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas pruebas. Espera unos minutos antes de volver a probar." },
});

const testSchema = z.object({ config: mailInputSchema, to: z.string().trim().toLowerCase().email("Correo inválido") });

/**
 * Correo saliente (SMTP), igual para la plataforma y para cada empresa:
 *   GET    /       configuración actual (sin contraseña) y qué respaldo hay
 *   PUT    /       guardar
 *   DELETE /       quitar (vuelve a usar el respaldo)
 *   POST   /test   enviar un correo de prueba con los datos del formulario
 * Quien monta el router ya exigió el rol (global_admin o client_admin).
 */
export function mailRouter({ scope, organization, tenantSlug }: MailRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const log = (req: Request, input: Omit<AuditInput, "tenantSlug" | "targetType">) =>
    audit(req, { ...input, targetType: "settings", targetLabel: "Correo saliente (SMTP)", tenantSlug: tenantSlug?.(req) });

  async function state(req: Request) {
    const s = scope(req);
    const fallback = await fallbackStatus();
    return {
      mail: publicMail(await getMail(s)),
      // Para una empresa, el respaldo es el SMTP de la plataforma o el del servidor; para la plataforma, solo el del servidor.
      fallback: s.kind === "tenant" ? fallback.platform || fallback.env : fallback.env,
    };
  }

  router.get("/", async (req, res) => {
    res.json(await state(req));
  });

  router.put("/", async (req, res) => {
    const input = mailInputSchema.parse(req.body);
    const saved = await saveMail(scope(req), input, req.actor!.id);
    await log(req, { action: "mail.updated", metadata: { host: saved.host, port: saved.port, fromEmail: saved.fromEmail } });
    res.json(await state(req));
  });

  router.delete("/", async (req, res) => {
    if (await removeMail(scope(req))) await log(req, { action: "mail.removed" });
    res.json(await state(req));
  });

  router.post("/test", testLimiter, async (req, res) => {
    const { config, to } = testSchema.parse(req.body);
    const result = await testMail(scope(req), config, to, organization(req));
    await log(req, { action: "mail.tested", metadata: { host: config.host, to, ok: result.ok } });
    res.json({ result, ...(await state(req)) });
  });

  return router;
}
