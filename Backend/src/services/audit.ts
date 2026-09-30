import type { Request } from "express";
import { config } from "../config.js";
import { globalPool } from "../db/pool.js";

/**
 * Bitácora de auditoría de la plataforma (base global). Registra las acciones
 * del equipo BeeHives y los accesos de todos los usuarios.
 */
export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.mfa_failed"
  | "auth.mfa_enrolled"
  | "auth.password_changed"
  | "auth.password_reset_requested"
  | "auth.password_reset_failed"
  | "auth.password_reset"
  | "auth.recovery_codes_regenerated"
  | "auth.role_switched"
  | "tenant.created"
  | "tenant.updated"
  | "tenant.suspended"
  | "tenant.reactivated"
  | "client_admin.created"
  | "client_admin.deactivated"
  | "client_admin.reactivated"
  | "client_admin.password_reset"
  | "client_admin.mfa_reset"
  | "global_admin.created"
  | "global_admin.deactivated"
  | "global_admin.reactivated"
  | "global_admin.password_reset"
  | "global_admin.mfa_reset"
  // Acciones del client_admin dentro de su empresa
  | "user.created"
  | "user.updated"
  | "user.deactivated"
  | "user.reactivated"
  | "user.password_reset"
  | "user.mfa_reset"
  | "category.created"
  | "category.updated"
  | "settings.updated"
  | "mail.updated"
  | "mail.removed"
  | "mail.tested"
  | "area.created"
  | "area.updated"
  | "area.deleted"
  | "area.categories_updated"
  | "case.viewed"
  | "case.start_review"
  | "case.reclassify"
  | "case.involve"
  | "case.assign"
  | "case.measure"
  | "case.authority"
  | "case.note"
  | "case.diligence"
  | "case.propose"
  | "case.dismiss"
  | "case.approve"
  | "case.reject"
  | "case.message"
  | "case.set_route"
  | "case.milestone"
  | "case.add_task"
  | "case.extend_deadline"
  | "flow.updated"
  | "case.registered"
  | "cases.demo_loaded"
  | "cases.demo_cleared";

export interface AuditInput {
  action: AuditAction;
  targetType?: "tenant" | "client_admin" | "global_admin" | "user" | "category" | "settings" | "area" | "case";
  targetId?: string;
  targetLabel?: string;
  tenantSlug?: string;
  metadata?: Record<string, unknown>;
  /** Por defecto es el usuario autenticado del request (req.actor). */
  actor?: { id: string | null; email: string | null; role?: string | null };
}

export interface AuditEvent {
  id: string;
  occurred_at: Date;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: AuditAction;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  tenant_slug: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Registra un evento. Si la escritura falla, se informa en el log pero no se
 * interrumpe la operación del usuario (la acción ya ocurrió).
 */
export async function audit(req: Request, input: AuditInput): Promise<void> {
  const actor = input.actor ?? { id: req.actor?.id ?? null, email: req.actor?.email ?? null, role: req.actor?.role };
  try {
    // «Abrió la denuncia» es el evento más frecuente: se guarda una vez por persona, rol y denuncia en la ventana
    // configurada (por defecto 30 minutos). Se conserva quién la abrió y cuándo, sin repetirlo en cada recarga.
    if (input.action === "case.viewed" && actor.id && input.targetId && config.audit.caseViewWindowMinutes > 0) {
      const recent = await globalPool.query(
        `SELECT 1 FROM audit_events
         WHERE action = 'case.viewed' AND actor_id = $1 AND target_id = $2 AND actor_role IS NOT DISTINCT FROM $3
           AND occurred_at > now() - make_interval(mins => $4)
         LIMIT 1`,
        [actor.id, input.targetId, actor.role ?? null, config.audit.caseViewWindowMinutes],
      );
      if (recent.rowCount) return;
    }
    await globalPool.query(
      `INSERT INTO audit_events
         (actor_id, actor_email, actor_role, action, target_type, target_id, target_label, tenant_slug, ip, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        actor.id,
        actor.email,
        actor.role ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.targetLabel ?? null,
        input.tenantSlug ?? null,
        req.ip?.replace(/^::ffff:/, "") ?? null,
        req.get("user-agent")?.slice(0, 300) ?? null,
        input.metadata ?? {},
      ],
    );
  } catch (err) {
    console.error("[auditoría] No se pudo registrar el evento", input.action, err);
  }
}

export interface AuditFilters {
  /** Prefijo de acción: "auth", "tenant", "client_admin", "global_admin" o una acción exacta. */
  action?: string;
  tenant?: string;
  /** Texto libre: email del actor, objetivo o IP. */
  q?: string;
  /** Paginación por cursor: eventos con id menor a este. */
  before?: string;
  limit?: number;
}

export async function listAuditEvents(filters: AuditFilters): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  if (filters.action) {
    if (filters.action.includes(".")) add("action = ?", filters.action);
    else add("action LIKE ?", `${filters.action}.%`);
  }
  if (filters.tenant) add("tenant_slug = ?", filters.tenant);
  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(actor_email) LIKE ${p} OR lower(target_label) LIKE ${p} OR ip LIKE ${p})`);
  }
  if (filters.before) add("id < ?", filters.before);

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const res = await globalPool.query<AuditEvent>(
    `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY id DESC LIMIT ${limit + 1}`,
    params,
  );
  const events = res.rows.slice(0, limit);
  return { events, nextCursor: res.rows.length > limit ? events[events.length - 1]!.id : null };
}
