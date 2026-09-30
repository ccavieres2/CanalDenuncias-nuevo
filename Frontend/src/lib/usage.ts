/** Consumo de una empresa (consola BeeHives). Solo cifras: nada del contenido de las denuncias. */
export interface TenantUsage {
  slug: string;
  name: string;
  status: "provisioning" | "active" | "suspended";
  plan: string;
  cases: {
    total: number;
    open: number;
    closed: number;
    thisMonth: number;
    last30Days: number;
    byFramework: Record<string, number>;
    demo: number;
  };
  files: { evidenceCount: number; evidenceBytes: number; logoBytes: number; totalBytes: number };
  databaseBytes: number;
  storageBytes: number;
  users: { active: number; total: number };
  areas: number;
  categories: number;
  error: string | null;
}

/** Tabla de consumo como CSV (separador «;», que Excel en español abre en columnas). */
export function usageCsv(rows: TenantUsage[]): string {
  const mb = (b: number) => (b / 1024 / 1024).toFixed(2).replace(".", ",");
  const header = [
    "Empresa",
    "Slug",
    "Plan",
    "Estado",
    "Denuncias (total)",
    "Abiertas",
    "Cerradas",
    "Este mes",
    "Últimos 30 días",
    "Ley Karin",
    "Ley 20.393",
    "Ley 21.719",
    "Normativa interna",
    "Evidencias (archivos)",
    "Evidencias (MB)",
    "Logo (MB)",
    "Base de datos (MB)",
    "Almacenamiento total (MB)",
    "Usuarios activos",
  ];
  const cell = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((u) =>
    [
      u.name,
      u.slug,
      u.plan,
      u.status,
      u.cases.total,
      u.cases.open,
      u.cases.closed,
      u.cases.thisMonth,
      u.cases.last30Days,
      u.cases.byFramework.ley_karin ?? 0,
      u.cases.byFramework.ley_20393 ?? 0,
      u.cases.byFramework.ley_21719 ?? 0,
      u.cases.byFramework.internal ?? 0,
      u.files.evidenceCount,
      mb(u.files.evidenceBytes),
      mb(u.files.logoBytes),
      mb(u.databaseBytes),
      mb(u.storageBytes),
      u.users.active,
    ]
      .map(cell)
      .join(";"),
  );
  // BOM para que Excel reconozca las tildes.
  return "﻿" + [header.join(";"), ...lines].join("\r\n");
}
