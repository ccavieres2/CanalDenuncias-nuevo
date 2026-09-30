export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Todos los roles de la persona (en la consola BeeHives es solo global_admin). */
  roles?: string[];
  mustChangePassword?: boolean;
  mfaEnabledAt?: string | null;
  recoveryCodesRemaining?: number;
  passwordChangedAt?: string;
}

export type TenantStatus = "provisioning" | "active" | "suspended";

export interface TenantProfile {
  legalName: string | null;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
}

export interface Tenant extends TenantProfile {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  /** Plan comercial (ver Planes en la consola). */
  planId: string;
  dbName: string;
  createdAt: string;
  updatedAt: string;
}

/** Cuenta administrada desde la consola (client_admin o miembro del equipo). */
export interface ManagedAccount {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface ClientAdmin extends ManagedAccount {
  role: "client_admin";
}

export type TeamMember = ManagedAccount;

/** Contraseña temporal entregada al crear o resetear una cuenta. Se muestra una sola vez. */
export interface Credentials {
  email: string;
  temporaryPassword: string;
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  tenant_slug: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
}

export interface Overview {
  tenants: { total: number; active: number; suspended: number };
  clientAdmins: { total: number; mfaPending: number };
  team: { total: number; mfaPending: number };
  last24h: { logins: number; failedLogins: number };
  unreachableTenants: number;
  attention: { slug: string; name: string; reason: string }[];
  recentTenants: { name: string; slug: string; status: TenantStatus; createdAt: string }[];
  recentActivity: AuditEvent[];
}

export interface SystemStatus {
  /** Auditoría: lo que está en la base (meses recientes) y los meses archivados en el almacenamiento. */
  audit: {
    hotMonths: number;
    database: { events: number; bytes: number; oldest: string | null };
    archives: { month: string; key: string; events: number; bytes: number; archivedAt: string }[];
  };
  database: {
    host: string | null;
    version: string;
    globalSizeBytes: number;
    globalMigration: string | null;
    latencyMs: number;
  };
  tenantSchema: { latest: string | null; total: number };
  tenants: ({ slug: string; name: string; status: TenantStatus; dbName: string; dbHost: string } & (
    | { reachable: false; error: string }
    | {
        reachable: true;
        latencyMs: number;
        sizeBytes: number;
        users: number;
        migration: string | null;
        pendingMigrations: string[];
      }
  ))[];
  checkedAt: string;
}

/** Paso 1: contraseña correcta. Falta el segundo factor. */
export interface LoginStartResponse {
  mfa: "setup" | "verify";
  mfaToken: string;
  user: { name: string; email: string };
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

/**
 * Paso final: sesión iniciada. `recoveryCodes` solo viene al configurar el 2FA por
 * primera vez; `mustChangePassword` indica que la contraseña es temporal.
 */
export interface MfaVerifyResponse {
  token: string;
  user: User;
  mustChangePassword: boolean;
  recoveryCodes?: string[];
}
