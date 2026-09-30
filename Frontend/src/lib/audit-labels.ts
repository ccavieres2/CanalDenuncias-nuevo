import type { AuditEvent } from "./types";

export type AuditTone = "neutral" | "success" | "warning" | "danger";

/** Texto legible y tono de cada acción de la bitácora. */
export const AUDIT_ACTIONS: Record<string, { label: string; tone: AuditTone }> = {
  "auth.login": { label: "Inicio de sesión", tone: "neutral" },
  "auth.login_failed": { label: "Contraseña incorrecta", tone: "danger" },
  "auth.mfa_failed": { label: "Código 2FA incorrecto", tone: "danger" },
  "auth.mfa_enrolled": { label: "Configuró la verificación en dos pasos", tone: "success" },
  "auth.password_changed": { label: "Cambió su contraseña", tone: "neutral" },
  "auth.password_reset_requested": { label: "Pidió recuperar su contraseña", tone: "neutral" },
  "auth.password_reset_failed": { label: "Código de recuperación incorrecto", tone: "danger" },
  "auth.password_reset": { label: "Recuperó su contraseña por correo", tone: "neutral" },
  "case.add_task": { label: "Agregó una tarea a una denuncia", tone: "neutral" },
  "case.extend_deadline": { label: "Extendió un plazo de una denuncia", tone: "warning" },
  "flow.updated": { label: "Cambió un flujo de gestión", tone: "warning" },
  "mail.updated": { label: "Configuró el correo saliente", tone: "warning" },
  "mail.removed": { label: "Quitó el correo saliente", tone: "warning" },
  "mail.tested": { label: "Probó el correo saliente", tone: "neutral" },
  "auth.recovery_codes_regenerated": { label: "Regeneró sus códigos de recuperación", tone: "neutral" },
  "auth.role_switched": { label: "Cambió de rol", tone: "neutral" },
  "tenant.created": { label: "Creó la empresa", tone: "success" },
  "tenant.updated": { label: "Editó la ficha de la empresa", tone: "neutral" },
  "tenant.suspended": { label: "Suspendió la empresa", tone: "warning" },
  "tenant.reactivated": { label: "Reactivó la empresa", tone: "success" },
  "tenant.plan_changed": { label: "Cambió el plan de la empresa", tone: "warning" },
  "plan.created": { label: "Creó un plan", tone: "success" },
  "plan.updated": { label: "Editó un plan", tone: "neutral" },
  "plan.deleted": { label: "Eliminó un plan", tone: "warning" },
  "client_admin.created": { label: "Creó un administrador de empresa", tone: "success" },
  "client_admin.deactivated": { label: "Desactivó un administrador de empresa", tone: "warning" },
  "client_admin.reactivated": { label: "Reactivó un administrador de empresa", tone: "success" },
  "client_admin.password_reset": { label: "Restableció la contraseña de un administrador", tone: "warning" },
  "client_admin.mfa_reset": { label: "Restableció el 2FA de un administrador", tone: "warning" },
  "global_admin.created": { label: "Agregó un miembro al equipo", tone: "success" },
  "global_admin.deactivated": { label: "Desactivó a un miembro del equipo", tone: "warning" },
  "global_admin.reactivated": { label: "Reactivó a un miembro del equipo", tone: "success" },
  "global_admin.password_reset": { label: "Restableció la contraseña de un miembro", tone: "warning" },
  "global_admin.mfa_reset": { label: "Restableció el 2FA de un miembro", tone: "warning" },
  "user.created": { label: "Creó un usuario", tone: "success" },
  "user.updated": { label: "Modificó un usuario", tone: "neutral" },
  "user.deactivated": { label: "Desactivó un usuario", tone: "warning" },
  "user.reactivated": { label: "Reactivó un usuario", tone: "success" },
  "user.password_reset": { label: "Restableció la contraseña de un usuario", tone: "warning" },
  "user.mfa_reset": { label: "Restableció el 2FA de un usuario", tone: "warning" },
  "category.created": { label: "Creó una categoría", tone: "success" },
  "category.updated": { label: "Modificó una categoría", tone: "neutral" },
  "settings.updated": { label: "Modificó la configuración", tone: "neutral" },
  "area.created": { label: "Creó un área", tone: "success" },
  "area.updated": { label: "Renombró un área", tone: "neutral" },
  "area.deleted": { label: "Eliminó un área", tone: "warning" },
  "area.categories_updated": { label: "Cambió las categorías autorizadas de un área", tone: "neutral" },
  "case.viewed": { label: "Abrió una denuncia", tone: "neutral" },
  "case.file_downloaded": { label: "Descargó una evidencia", tone: "neutral" },
  "case.start_review": { label: "Inició la revisión de una denuncia", tone: "neutral" },
  "case.reclassify": { label: "Reclasificó una denuncia", tone: "neutral" },
  "case.involve": { label: "Actualizó el conflicto de interés de una denuncia", tone: "warning" },
  "case.assign": { label: "Asignó el investigador de una denuncia", tone: "neutral" },
  "case.measure": { label: "Registró una medida de resguardo", tone: "neutral" },
  "case.authority": { label: "Registró un aviso a la autoridad", tone: "neutral" },
  "case.note": { label: "Agregó una nota interna", tone: "neutral" },
  "case.diligence": { label: "Registró una diligencia", tone: "neutral" },
  "case.propose": { label: "Propuso la conclusión de una denuncia", tone: "neutral" },
  "case.dismiss": { label: "Propuso desestimar una denuncia", tone: "warning" },
  "case.approve": { label: "Aprobó el cierre de una denuncia", tone: "success" },
  "case.reject": { label: "Rechazó el cierre de una denuncia", tone: "warning" },
  "case.message": { label: "Escribió al denunciante", tone: "neutral" },
  "case.set_route": { label: "Definió el procedimiento Ley Karin", tone: "neutral" },
  "case.milestone": { label: "Registró un hito del procedimiento", tone: "neutral" },
  "case.registered": { label: "Registró una denuncia recibida por otra vía", tone: "neutral" },
  "cases.demo_loaded": { label: "Cargó denuncias de ejemplo", tone: "neutral" },
  "cases.demo_cleared": { label: "Quitó las denuncias de ejemplo", tone: "neutral" },
};

/** Filtros de la auditoría dentro de una empresa. */
export const CHANNEL_AUDIT_CATEGORIES = [
  { value: "", label: "Todas las acciones" },
  { value: "auth", label: "Accesos y seguridad" },
  { value: "user", label: "Usuarios" },
  { value: "category", label: "Categorías" },
  { value: "area", label: "Áreas" },
  { value: "case", label: "Denuncias" },
  { value: "settings", label: "Configuración" },
];

/** Filtros por categoría (prefijo de la acción). */
export const AUDIT_CATEGORIES = [
  { value: "", label: "Todas las acciones" },
  { value: "auth", label: "Accesos y seguridad" },
  { value: "tenant", label: "Empresas" },
  { value: "client_admin", label: "Administradores de empresa" },
  { value: "global_admin", label: "Equipo BeeHives" },
];

export const TONE_DOT: Record<AuditTone, string> = {
  neutral: "bg-gray-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

export function auditLabel(event: AuditEvent) {
  return AUDIT_ACTIONS[event.action] ?? { label: event.action, tone: "neutral" as const };
}

const FIELD_LABELS: Record<string, string> = {
  name: "nombre",
  legalName: "razón social",
  taxId: "RUT",
  contactName: "contacto",
  contactEmail: "email de contacto",
  contactPhone: "teléfono",
  notes: "notas",
  role: "rol",
  area: "área",
  categories: "categorías",
  description: "descripción",
  legalFramework: "marco legal",
  isActive: "estado",
  roles: "roles",
  areas: "áreas autorizadas",
};

export const ROLE_LABELS: Record<string, string> = {
  global_admin: "Equipo BeeHives",
  client_admin: "Administrador del canal",
  case_manager: "Gestor de denuncias",
  investigator: "Investigador",
  resolver: "Comité / Resolutor",
  auditor: "Auditor",
};

/** Detalle adicional en una línea (campos editados, método de acceso, etc.). */
export function auditDetail(event: AuditEvent): string | null {
  const m = event.metadata ?? {};
  if (typeof m.from === "string" && event.action === "area.updated") return `Antes: ${m.from}`;
  const roleName = (r: unknown) => ROLE_LABELS[String(r)] ?? String(r);
  const roleList = (v: unknown) => (Array.isArray(v) ? v.map(roleName).join(", ") : roleName(v));
  if (m.from !== undefined && m.to !== undefined && event.action !== "area.updated") {
    return `${Array.isArray(m.from) ? "Roles" : "Rol"}: ${roleList(m.from)} → ${roleList(m.to)}`;
  }
  if (Array.isArray(m.fields)) return `Campos: ${m.fields.map((f) => FIELD_LABELS[String(f)] ?? f).join(", ")}`;
  if (Array.isArray(m.added) || Array.isArray(m.removed)) {
    const add = Array.isArray(m.added) && m.added.length ? `Autorizó: ${m.added.join(", ")}` : "";
    const rem = Array.isArray(m.removed) && m.removed.length ? `Quitó: ${m.removed.join(", ")}` : "";
    return [add, rem].filter(Boolean).join(" · ") || null;
  }
  if (typeof m.role === "string") return `Rol: ${roleName(m.role)}`;
  if (Array.isArray(m.roles)) return `Roles: ${roleList(m.roles)}`;
  if (m.method === "recovery_code") return "Ingresó con un código de recuperación";
  if (typeof m.initialAdmin === "string") return `Administrador inicial: ${m.initialAdmin}`;
  return null;
}

/** Resume el user-agent en "Navegador · Sistema". */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : /node|undici/i.test(ua)
            ? "Script"
            : "Otro";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}
