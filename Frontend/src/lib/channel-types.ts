import type { LegalFramework, TenantRole } from "./roles";

export interface ChannelMember {
  id: string;
  email: string;
  name: string;
  roles: TenantRole[];
  area_id: string | null;
  area: string | null;
  is_active: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
  all_categories: boolean;
  category_ids: string[];
  created_at: string;
  last_login_at: string | null;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  legal_framework: LegalFramework;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Áreas autorizadas para hacerse cargo; vacío = cualquier área. */
  area_ids: string[];
  /** Gestores, investigadores y resolutores activos que pueden ver la categoría. */
  assigned_users: number;
}

export interface PortalSettings {
  title: string;
  welcome: string;
  policy: string;
  allowAnonymous: boolean;
  contactEmail: string | null;
  reportEmail: string | null;
  phone: string | null;
  inPerson: string | null;
}

export type ChannelMode = "simplified" | "complete";

export interface CaseRules {
  mode: ChannelMode;
  retentionMonths: number;
  conflictPlan: { substituteUserId: string | null; externalContact: string | null };
}

export interface ChannelOverview {
  users: {
    total: number;
    byRole: Record<TenantRole, number>;
    mfaPending: number;
    passwordPending: number;
    withoutArea: number;
  };
  categories: { active: number; total: number; leyKarin: number; uncovered: { id: string; name: string }[] };
  portal: { allowAnonymous: boolean; hasPolicy: boolean };
  caseRules: CaseRules;
  checklist: { key: string; done: boolean; title: string; detail: string; to: string }[];
}

export interface Area {
  id: string;
  name: string;
  /** Usuarios activos del área. */
  users: number;
  /** Categorías que autorizan esta área. */
  categories: number;
}

/** ¿El área puede hacerse cargo de la categoría? (misma regla que el backend) */
export const areaAllowed = (category: Pick<Category, "area_ids">, areaId: string | null) =>
  areaId !== null && category.area_ids.includes(areaId);
