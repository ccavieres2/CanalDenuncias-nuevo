import { type Request, Router } from "express";
import { createHmac, randomBytes } from "node:crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { publicBranding, readLogo } from "../services/branding.js";
import { signReporterToken, verifyReporterToken } from "../services/auth.js";
import {
  addReporterMessage,
  authenticateByAuthenticator,
  authenticateByKey,
  authenticatorConfirm,
  authenticatorRemove,
  authenticatorSetup,
  getPublicPortal,
  getReporterView,
  submitReport,
} from "../services/cases.js";

/**
 * Portal del denunciante: /api/t/:slug/public/... Sin cuenta: el denunciante entra con su clave de seguimiento o
 * con el código de su app de autenticación, y recibe una sesión de 30 minutos solo para su denuncia. Cada empresa
 * recibe las denuncias en su propia base. No se guarda la IP ni el dispositivo del denunciante (los límites de
 * intentos solo viven en memoria).
 */
export const publicRouter = Router({ mergeParams: true });

// Nada del portal debe quedar guardado en el navegador, en un proxy de la red de la empresa ni viajar como
// «página de origen» a otros sitios.
publicRouter.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer" });
  next();
});

/**
 * Los límites de intentos necesitan distinguir conexiones, pero no guardan la IP: usan una huella HMAC con una clave
 * aleatoria que solo existe en la memoria de este proceso (cambia en cada reinicio) y que nunca se escribe en disco.
 */
const ipSecret = randomBytes(32);
const fingerprint = (value: string) => createHmac("sha256", ipSecret).update(value).digest("base64url");

const limiter = (limit: number, windowMinutes: number, message: string) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message },
    // ipKeyGenerator agrupa IPv6 por subred (para que no se pueda esquivar el límite) antes de la huella.
    keyGenerator: (req) => fingerprint(ipKeyGenerator(req.ip ?? "")),
  });

const submitLimiter = limiter(10, 60, "Se enviaron demasiadas denuncias desde esta conexión. Intenta nuevamente en una hora.");
// Impide adivinar claves de seguimiento por fuerza bruta.
const trackLimiter = limiter(40, 15, "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.");

const keySchema = z.string().trim().min(16).max(40);

publicRouter.get("/portal", async (req, res) => {
  const [portal, branding] = await Promise.all([getPublicPortal(req.tenant!), publicBranding(req.tenant!)]);
  res.json({ ...portal, branding });
});

/** Logo de la empresa (lo usan el portal, la pantalla de ingreso y el panel). */
publicRouter.get("/logo", async (req, res) => {
  const logo = await readLogo(req.tenant!);
  if (!logo) throw new HttpError(404, "Sin logo");
  res.set({
    "Content-Type": logo.mime,
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(logo.body);
});

/** Id de la denuncia de una sesión del denunciante válida para esta empresa. */
function sessionCase(req: Request): string {
  const { session } = z.object({ session: z.string().min(10).max(2000) }).parse(req.body);
  const payload = verifyReporterToken(session, req.tenant!.slug);
  if (!payload) throw new HttpError(401, "Tu sesión expiró. Vuelve a ingresar.");
  return payload.sub;
}

const withSession = async (tenant: Request["tenant"], caseId: string) => ({
  ...(await getReporterView(tenant!, caseId)),
  session: signReporterToken(caseId, tenant!.slug),
});

publicRouter.post("/reports", submitLimiter, async (req, res) => {
  const { id, code, trackingKey } = await submitReport(req.tenant!, req.body);
  // La sesión permite asociar la app de autenticación de inmediato, sin volver a escribir la clave.
  res.status(201).json({ code, trackingKey, session: signReporterToken(id, req.tenant!.slug) });
});

/**
 * Ingreso al seguimiento: con la clave de seguimiento o con el código de la denuncia + el código de la app de
 * autenticación. POST para que nada de esto quede en la URL ni en los registros del servidor.
 */
publicRouter.post("/track", trackLimiter, async (req, res) => {
  const input = z
    .union([
      z.object({ key: keySchema }),
      z.object({
        code: z.string().trim().regex(/^DEN-\d{4}-\d{4,}$/i, { message: "Código de denuncia inválido" }),
        otp: z.string().trim().regex(/^\d{6}$/, { message: "El código de la app tiene 6 dígitos" }),
      }),
    ])
    .parse(req.body);
  const caseId =
    "key" in input
      ? await authenticateByKey(req.tenant!, input.key)
      : await authenticateByAuthenticator(req.tenant!, input.code, input.otp);
  res.json(await withSession(req.tenant, caseId));
});

publicRouter.post("/track/view", trackLimiter, async (req, res) => {
  res.json(await withSession(req.tenant, sessionCase(req)));
});

publicRouter.post("/track/messages", trackLimiter, async (req, res) => {
  const caseId = sessionCase(req);
  const { body } = z
    .object({
      body: z
        .string()
        .trim()
        .min(1, { message: "Escribe un mensaje" })
        .max(5000, { message: "El mensaje admite hasta 5000 caracteres" }),
    })
    .parse(req.body);
  await addReporterMessage(req.tenant!, caseId, body);
  res.status(201).json(await withSession(req.tenant, caseId));
});

/* ---------- App de autenticación del denunciante (opcional) */

publicRouter.post("/track/authenticator/setup", trackLimiter, async (req, res) => {
  res.json(await authenticatorSetup(req.tenant!, sessionCase(req)));
});

publicRouter.post("/track/authenticator/confirm", trackLimiter, async (req, res) => {
  const caseId = sessionCase(req);
  const { otp } = z.object({ otp: z.string().trim().regex(/^\d{6}$/, { message: "El código tiene 6 dígitos" }) }).parse(req.body);
  await authenticatorConfirm(req.tenant!, caseId, otp);
  res.json(await withSession(req.tenant, caseId));
});

publicRouter.post("/track/authenticator/remove", trackLimiter, async (req, res) => {
  const caseId = sessionCase(req);
  await authenticatorRemove(req.tenant!, caseId);
  res.json(await withSession(req.tenant, caseId));
});
