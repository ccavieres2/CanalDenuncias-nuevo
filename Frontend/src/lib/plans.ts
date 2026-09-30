import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import type { LegalFramework } from "./roles";

/** Módulos que un plan puede incluir (mismas claves que PLAN_FEATURES en el backend). */
export type PlanFeature =
  | "evidence"
  | "custom_flows"
  | "branding"
  | "custom_smtp"
  | "reporter_authenticator"
  | "reports"
  | "register_cases";

export const PLAN_FEATURES: { key: PlanFeature; label: string; description: string }[] = [
  { key: "evidence", label: "Evidencias adjuntas", description: "El denunciante adjunta archivos desde su seguimiento." },
  { key: "reporter_authenticator", label: "App de autenticación del denunciante", description: "Seguir la denuncia con Google o Microsoft Authenticator." },
  { key: "register_cases", label: "Registro de denuncias por otras vías", description: "El gestor registra denuncias verbales, por carta, de la DT u otras autoridades." },
  { key: "reports", label: "Reportes", description: "Estadísticas de denuncias para gestor, comité y auditor." },
  { key: "custom_flows", label: "Flujos de gestión editables", description: "Plazos de referencia y pasos propios (salvo Ley Karin)." },
  { key: "branding", label: "Marca propia", description: "Logo y color de la empresa en el panel y el portal." },
  { key: "custom_smtp", label: "Correo saliente propio", description: "Enviar los correos desde el servidor SMTP de la empresa." },
];

/** Lo que el panel de la empresa sabe de su plan. */
export interface TenantPlan {
  name: string;
  frameworks: LegalFramework[];
  features: PlanFeature[];
  limits: { maxUsers: number | null; maxAreas: number | null; maxCategories: number | null };
}

/** Plan completo en la consola del global_admin. */
export interface Plan {
  id: string;
  name: string;
  description: string | null;
  frameworks: LegalFramework[];
  features: PlanFeature[];
  maxUsers: number | null;
  maxAreas: number | null;
  maxCategories: number | null;
  isActive: boolean;
  tenants: number;
  createdAt: string;
  updatedAt: string;
}

export const planHas = (plan: TenantPlan, feature: PlanFeature) => plan.features.includes(feature);

/** Planes de la consola (se usan al crear una empresa y en su ficha). */
export function usePlans(token: string, onUnauthorized: () => void) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ plans: Plan[] }>("/admin/plans", { token })
      .then((res) => setPlans(res.plans))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return onUnauthorized();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [token, onUnauthorized]);
  return { plans, error };
}
