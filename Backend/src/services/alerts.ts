import { config } from "../config.js";
import { type CaseRole, listDeadlines } from "./cases.js";
import { listUsers } from "./channel.js";
import { layout, sendMail } from "./mail.js";
import { type Tenant, listTenants, tenantPool } from "./tenants.js";

/**
 * Alertas de plazos: lo que está vencido o por vencer y le toca a cada persona, según el procedimiento legal y el
 * flujo de la empresa. Se muestran en la campana del panel y se envían en un resumen diario por correo.
 *
 * Responsable de cada plazo: los hitos legales y los pasos del gestor, los gestores que ven esa categoría (según su
 * área y categorías: Ley Karin → los gestores de Recursos Humanos); los pasos del investigador, el investigador
 * asignado. Los plazos que dependen de un tercero (la DT) no generan alertas.
 */

/** Días que se consideran «por vencer» (el mismo criterio que la columna de plazos del panel). */
export const DUE_SOON_DAYS = 5;
/** Hora de Chile desde la que se envía el resumen diario. */
const SEND_FROM_HOUR = 8;
const RESPONSIBLE_ROLES: readonly CaseRole[] = ["case_manager", "investigator"];

export interface Alert {
  caseId: string;
  code: string;
  label: string;
  dueAt: Date;
  legal: boolean;
  isDemo: boolean;
  /** Días calendario hasta el vencimiento (negativo = vencido). */
  days: number;
}

const DAY = 86_400_000;

/** Plazos a cargo de la persona con ese rol, vencidos o por vencer. */
async function alertsFor(tenant: Tenant, userId: string, role: CaseRole): Promise<Alert[]> {
  if (!RESPONSIBLE_ROLES.includes(role)) return [];
  const now = Date.now();
  const deadlines = await listDeadlines(tenant, userId, role);
  return deadlines
    .filter((d) => !d.external && (role === "investigator" ? d.owner === "investigator" : d.owner !== "investigator"))
    .map((d) => ({
      caseId: d.case.id,
      code: d.case.code,
      label: d.label,
      dueAt: d.dueAt!,
      legal: d.legal,
      isDemo: d.case.isDemo,
      days: Math.floor((d.dueAt!.getTime() - now) / DAY),
    }))
    .filter((a) => a.dueAt.getTime() - now <= DUE_SOON_DAYS * DAY);
}

/** Alertas para la campana del panel (rol activo de la sesión). */
export async function getAlerts(tenant: Tenant, userId: string, role: CaseRole) {
  const now = Date.now();
  const alerts = await alertsFor(tenant, userId, role);
  return {
    overdue: alerts.filter((a) => a.dueAt.getTime() < now),
    dueSoon: alerts.filter((a) => a.dueAt.getTime() >= now),
    dueSoonDays: DUE_SOON_DAYS,
  };
}

/* ------------------------------------------------------------------ Resumen diario por correo */

const chileParts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

const describe = (a: Alert) =>
  a.days < 0
    ? `${a.code} · ${a.label}: venció el ${formatDate(a.dueAt)} (hace ${-a.days} ${a.days === -1 ? "día" : "días"})${a.legal ? " · plazo legal" : ""}`
    : `${a.code} · ${a.label}: vence el ${formatDate(a.dueAt)}${a.days === 0 ? " (hoy)" : ` (en ${a.days} ${a.days === 1 ? "día" : "días"})`}${a.legal ? " · plazo legal" : ""}`;

/**
 * Envía el resumen del día a cada persona con plazos vencidos o por vencer. Solo el código de la denuncia, el hito y
 * la fecha: nunca el relato ni nombres (el correo puede quedar en bandejas compartidas o reenviarse).
 */
export async function sendTenantReminders(tenant: Tenant, today: string): Promise<number> {
  const pool = tenantPool(tenant);
  const users = (await listUsers(tenant)).filter((u) => u.is_active && u.roles.some((r) => RESPONSIBLE_ROLES.includes(r as CaseRole)));
  let sent = 0;
  for (const user of users) {
    // Una persona con los dos roles recibe un solo correo con todo lo suyo.
    const byKey = new Map<string, Alert>();
    for (const role of RESPONSIBLE_ROLES.filter((r) => user.roles.includes(r))) {
      for (const a of await alertsFor(tenant, user.id, role)) if (!a.isDemo) byKey.set(`${a.caseId}:${a.label}`, a);
    }
    const alerts = [...byKey.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    if (!alerts.length) continue;
    const overdue = alerts.filter((a) => a.days < 0);
    const soon = alerts.filter((a) => a.days >= 0);

    // Reserva el envío del día; si ya existe, otra ejecución (u otra instancia) ya lo mandó.
    const reserved = await pool.query(
      "INSERT INTO deadline_reminders (user_id, sent_on, overdue, due_soon) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [user.id, today, overdue.length, soon.length],
    );
    if (!reserved.rowCount) continue;

    const title = overdue.length
      ? `Tienes ${overdue.length} ${overdue.length === 1 ? "plazo vencido" : "plazos vencidos"}`
      : `Tienes ${soon.length} ${soon.length === 1 ? "plazo por vencer" : "plazos por vencer"}`;
    const lines = [
      ...(overdue.length ? ["Vencidos:", ...overdue.map(describe)] : []),
      ...(soon.length ? [`Por vencer (próximos ${DUE_SOON_DAYS} días):`, ...soon.map(describe)] : []),
    ];
    const link = `${config.appUrl}/${tenant.slug}/deadlines`;
    try {
      await sendMail(
        {
          to: user.email,
          subject: `${title} en el canal de denuncias`,
          text: [`Hola ${user.name}:`, "", `${title} en las denuncias a tu cargo.`, "", ...lines, "", `Revísalos en: ${link}`].join("\n"),
          html: layout({
            organization: tenant.name,
            title,
            paragraphs: [`Hola ${user.name}: estas son las denuncias a tu cargo con plazos vencidos o por vencer.`, ...lines, `Revísalos en ${link}`],
            footer:
              "Recibes este resumen porque tienes denuncias a tu cargo en el canal. Se envía como máximo una vez al día mientras haya plazos pendientes.",
          }),
        },
        { tenant, organization: tenant.name },
      );
      sent++;
    } catch (err) {
      // Si falla, se libera el día para reintentar en la próxima ejecución.
      await pool.query("DELETE FROM deadline_reminders WHERE user_id = $1 AND sent_on = $2", [user.id, today]);
      console.error(`[alertas] no se pudo enviar el resumen a un usuario de ${tenant.slug}:`, err);
    }
  }
  return sent;
}

/** Recorre las empresas activas y envía los resúmenes pendientes del día (desde las 8:00 de Chile). */
export async function sendDeadlineReminders(now = new Date()): Promise<void> {
  const parts = chileParts(now);
  if (Number(parts.hour) < SEND_FROM_HOUR) return;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  for (const tenant of (await listTenants()).filter((t) => t.status === "active")) {
    try {
      const sent = await sendTenantReminders(tenant, today);
      if (sent) console.log(`[alertas] ${tenant.slug}: ${sent} resumen(es) de plazos enviados`);
    } catch (err) {
      console.error(`[alertas] falló el envío de resúmenes de ${tenant.slug}:`, err);
    }
  }
}
