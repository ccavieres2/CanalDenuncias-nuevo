import cors from "cors";
import helmet from "helmet";
import express from "express";
import { bootstrap } from "./bootstrap.js";
import { config } from "./config.js";
import { errorHandler } from "./errors.js";
import { sendDeadlineReminders } from "./services/alerts.js";
import { maintainAuditLog } from "./services/audit-maintenance.js";
import { adminRouter } from "./routes/admin.js";
import { tenantRouter } from "./routes/tenant.js";

const app = express();
app.set("trust proxy", config.trustProxy);
// Cabeceras de seguridad. La API solo devuelve JSON e imágenes: no carga nada ni puede mostrarse en un iframe.
app.use(
  helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
    // Solo tiene efecto por HTTPS. Sin includeSubDomains, para no afectar otros subdominios del dominio.
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: false },
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use(cors({ origin: config.corsOrigin.split(","), credentials: true }));
// 100 KB por defecto; solo la subida del logo de la empresa admite más (imagen en base64 de hasta 300 KB).
const jsonSmall = express.json();
const jsonLogo = express.json({ limit: "450kb" });
app.use((req, res, next) => (req.path.endsWith("/console/branding/logo") ? jsonLogo : jsonSmall)(req, res, next));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api/admin", adminRouter);
app.use("/api/t/:slug", tenantRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});
app.use(errorHandler);

await bootstrap();
app.listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}`);
});

// Mantenimiento de la auditoría: prepara los meses siguientes y archiva los antiguos. Al arrancar y cada 24 horas.
const runAuditMaintenance = () =>
  maintainAuditLog().catch((err) => console.error("[auditoría] Falló el mantenimiento", err));
void runAuditMaintenance();
setInterval(runAuditMaintenance, 24 * 60 * 60 * 1000).unref();

// Resumen diario de plazos por correo: se revisa cada hora y cada persona recibe como máximo uno al día (desde las
// 8:00 de Chile). El registro en deadline_reminders evita duplicados entre ejecuciones e instancias.
const runDeadlineReminders = () =>
  sendDeadlineReminders().catch((err) => console.error("[alertas] Falló el envío de resúmenes de plazos", err));
setTimeout(runDeadlineReminders, 60_000).unref();
setInterval(runDeadlineReminders, 60 * 60 * 1000).unref();
