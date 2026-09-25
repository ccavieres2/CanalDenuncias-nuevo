/** Roles de una empresa y marcos legales de las categorías, con sus textos para la interfaz. */

export type TenantRole = "client_admin" | "case_manager" | "investigator" | "resolver" | "auditor";
export type LegalFramework = "ley_karin" | "ley_20393" | "ley_21719" | "internal";

export const ROLES: Record<TenantRole, { label: string; short: string; description: string; seesCases: string }> = {
  client_admin: {
    label: "Administrador del canal",
    short: "Administrador",
    description: "Configura el canal: usuarios, roles, categorías, portal y reglas. No accede al contenido de las denuncias.",
    seesCases: "No ve denuncias",
  },
  case_manager: {
    label: "Gestor de denuncias",
    short: "Gestor",
    description:
      "Recibe las denuncias nuevas de sus categorías, las clasifica, revisa conflictos de interés y asigna al investigador.",
    seesCases: "Todas las de sus categorías",
  },
  investigator: {
    label: "Investigador",
    short: "Investigador",
    description: "Investiga los casos que se le asignan: diligencias, entrevistas, evidencia y propuesta de conclusión.",
    seesCases: "Solo las asignadas",
  },
  resolver: {
    label: "Comité / Resolutor",
    short: "Resolutor",
    description: "Revisa y aprueba el cierre, la desestimación y las medidas propuestas. Debe ser distinto del investigador.",
    seesCases: "Las que llegan a resolución",
  },
  auditor: {
    label: "Auditor",
    short: "Auditor",
    description: "Revisa trazabilidad y cumplimiento de plazos en modo solo lectura, sin datos que identifiquen a las personas.",
    seesCases: "Solo lectura, anonimizadas",
  },
};

export const ROLE_ORDER: TenantRole[] = ["client_admin", "case_manager", "investigator", "resolver", "auditor"];

/** Roles que trabajan denuncias y por eso se acotan a categorías. */
export const SCOPED_ROLES: TenantRole[] = ["case_manager", "investigator", "resolver"];
export const hasScopedRole = (roles: readonly TenantRole[]) => roles.some((r) => SCOPED_ROLES.includes(r));

/** Misma regla que el backend: en modalidad completa la administración y la auditoría no gestionan denuncias. */
export function roleCombinationError(roles: readonly TenantRole[], mode: "simplified" | "complete"): string | null {
  if (mode !== "complete" || !hasScopedRole(roles)) return null;
  if (roles.includes("client_admin")) return "En la modalidad completa, el administrador del canal no puede gestionar denuncias.";
  if (roles.includes("auditor")) return "En la modalidad completa, el auditor no puede gestionar denuncias.";
  return null;
}

/** Texto corto con todos los roles: "Gestor, Investigador y Resolutor". */
export function rolesLabel(roles: readonly TenantRole[]): string {
  const names = ROLE_ORDER.filter((r) => roles.includes(r)).map((r) => ROLES[r].short);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : (names[0] ?? "");
}

export const FRAMEWORKS: Record<LegalFramework, { label: string; description: string; styles: string; dot: string }> = {
  ley_karin: {
    label: "Ley Karin",
    description: "Acoso laboral, acoso sexual y violencia en el trabajo (Ley 21.643). Plazos legales y aviso a la Dirección del Trabajo.",
    styles: "bg-violet-50 text-violet-700 ring-violet-600/15",
    dot: "bg-violet-500",
  },
  ley_20393: {
    label: "Ley 20.393",
    description: "Delitos de la Ley 20.393 y la Ley 21.595 (Modelo de Prevención de Delitos).",
    styles: "bg-sky-50 text-sky-700 ring-sky-600/15",
    dot: "bg-sky-500",
  },
  ley_21719: {
    label: "Ley 21.719",
    description: "Protección de datos personales: uso indebido, filtraciones o accesos no autorizados. Reporte de vulneraciones a la Agencia.",
    styles: "bg-teal-50 text-teal-700 ring-teal-600/15",
    dot: "bg-teal-500",
  },
  internal: {
    label: "Normativa interna",
    description: "Faltas al código de ética, políticas o reglamento interno.",
    styles: "bg-gray-100 text-gray-700 ring-gray-500/15",
    dot: "bg-gray-400",
  },
};

/** Orden en que se muestran los marcos legales. */
export const FRAMEWORK_ORDER: LegalFramework[] = ["ley_karin", "ley_20393", "ley_21719", "internal"];
