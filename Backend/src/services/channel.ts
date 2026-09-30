import type pg from "pg";
import { HttpError, isUniqueViolation } from "../errors.js";
import { type TenantRole, hashPassword } from "./auth.js";
import { generateTemporaryPassword } from "./passwords.js";
import { hasFramework, planOf } from "./plans.js";
import { type IssuedCredentials, type Tenant, tenantPool } from "./tenants.js";

/**
 * Configuración del canal de una empresa (lo que administra el client_admin):
 * usuarios con roles y áreas, categorías de denuncia y ajustes. Todo vive en la base del tenant.
 *
 * Regla de acceso a una categoría para gestores, investigadores y resolutores:
 *   (tiene "todas las categorías" o la categoría asignada)
 *   Y (la categoría no restringe áreas o su área está autorizada)
 */

/** Roles que trabajan denuncias y por eso se acotan a categorías. */
export const SCOPED_ROLES: readonly TenantRole[] = ["case_manager", "investigator", "resolver"];
export const hasScopedRole = (roles: readonly TenantRole[]) => roles.some((r) => SCOPED_ROLES.includes(r));

/**
 * Modalidad de gestión:
 * - simplified: una misma persona puede recibir, investigar y cerrar (empresas pequeñas).
 * - complete: doble aprobación; quien investiga un caso no aprueba su cierre, y la
 *   administración y la auditoría no se combinan con roles que gestionan denuncias.
 */
export type ChannelMode = "simplified" | "complete";

/** En modalidad completa, estos roles no pueden combinarse con los que gestionan denuncias. */
export function roleCombinationError(roles: readonly TenantRole[], mode: ChannelMode): string | null {
  if (mode !== "complete" || !hasScopedRole(roles)) return null;
  if (roles.includes("client_admin")) {
    return "En la modalidad completa, el administrador del canal no puede gestionar denuncias. Usa la modalidad simplificada o asigna esos roles a otra persona.";
  }
  if (roles.includes("auditor")) {
    return "En la modalidad completa, el auditor no puede gestionar denuncias: debe revisar de forma independiente.";
  }
  return null;
}
export type LegalFramework = "ley_karin" | "ley_20393" | "ley_21719" | "internal";

export interface ChannelUser {
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
  created_at: Date;
  last_login_at: Date | null;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  legal_framework: LegalFramework;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  /** Áreas autorizadas; vacío = cualquier área. */
  area_ids: string[];
  /** Categoría «Otro»: pide a la persona que cuente de qué se trata. */
  asks_detail: boolean;
}

export interface Area {
  id: string;
  name: string;
  users: number;
  categories: number;
}

export interface PortalSettings {
  title: string;
  welcome: string;
  policy: string;
  allowAnonymous: boolean;
  contactEmail: string | null;
  /** Otras vías para denunciar ante la empresa (se muestran en el portal). */
  reportEmail: string | null;
  phone: string | null;
  inPerson: string | null;
}

export interface ConflictPlan {
  /** Suplente interno que recibe las denuncias que involucran al encargado. */
  substituteUserId: string | null;
  /** Contacto externo (abogado, directorio, investigador externo). */
  externalContact: string | null;
}

export interface CaseRules {
  mode: ChannelMode;
  retentionMonths: number;
  conflictPlan: ConflictPlan;
}

const USER_COLUMNS = `u.id, u.email, u.name, u.roles, u.area_id, a.name AS area, u.is_active, u.must_change_password,
  (u.totp_enabled_at IS NOT NULL) AS mfa_enabled, u.all_categories, u.created_at, u.last_login_at,
  COALESCE((SELECT array_agg(uc.category_id) FROM user_categories uc WHERE uc.user_id = u.id), '{}') AS category_ids`;
const USER_FROM = "users u LEFT JOIN areas a ON a.id = u.area_id";

const CATEGORY_COLUMNS = `c.*,
  COALESCE((SELECT array_agg(ca.area_id) FROM category_areas ca WHERE ca.category_id = c.id), '{}') AS area_ids`;

/**
 * ¿El área puede hacerse cargo de la categoría? Solo si está autorizada explícitamente en Categorías: una categoría
 * sin áreas no la gestiona nadie (y no aparece en el portal).
 */
export const areaAllowed = (category: Pick<Category, "area_ids">, areaId: string | null) =>
  areaId !== null && category.area_ids.includes(areaId);

/** Categorías que un usuario puede ver efectivamente (para roles que trabajan denuncias). */
export function effectiveCategories(user: ChannelUser, categories: Category[]): Category[] {
  if (!hasScopedRole(user.roles)) return [];
  return categories.filter(
    (c) => (user.all_categories || user.category_ids.includes(c.id)) && areaAllowed(c, user.area_id),
  );
}

async function inTransaction<T>(tenant: Tenant, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await tenantPool(tenant).connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

/* ------------------------------------------------------------------ Áreas */

export async function listAreas(tenant: Tenant): Promise<Area[]> {
  const res = await tenantPool(tenant).query<Area>(
    `SELECT a.id, a.name,
            (SELECT count(*)::int FROM users u WHERE u.area_id = a.id AND u.is_active) AS users,
            (SELECT count(*)::int FROM category_areas ca WHERE ca.area_id = a.id) AS categories
     FROM areas a ORDER BY a.name`,
  );
  return res.rows;
}

async function ensureArea(db: pg.PoolClient | pg.Pool, areaId: string) {
  const res = await db.query("SELECT 1 FROM areas WHERE id = $1", [areaId]);
  if (!res.rowCount) throw new HttpError(400, "El área seleccionada no existe");
}

export async function createArea(tenant: Tenant, name: string): Promise<Area> {
  try {
    const res = await tenantPool(tenant).query<{ id: string; name: string }>(
      "INSERT INTO areas (name) VALUES ($1) RETURNING id, name",
      [name],
    );
    return { ...res.rows[0]!, users: 0, categories: 0 };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe un área llamada "${name}"`);
    throw err;
  }
}

export async function renameArea(tenant: Tenant, id: string, name: string): Promise<{ before: string; after: string }> {
  try {
    const res = await tenantPool(tenant).query<{ before: string; after: string }>(
      `UPDATE areas a SET name = $2, updated_at = now()
       FROM (SELECT name FROM areas WHERE id = $1) old
       WHERE a.id = $1 RETURNING old.name AS before, a.name AS after`,
      [id, name],
    );
    if (!res.rows[0]) throw new HttpError(404, "Área no encontrada");
    return res.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe un área llamada "${name}"`);
    throw err;
  }
}

/** Solo se elimina un área sin usuarios ni categorías asociadas. */
export async function deleteArea(tenant: Tenant, id: string): Promise<string> {
  const area = (await listAreas(tenant)).find((a) => a.id === id);
  if (!area) throw new HttpError(404, "Área no encontrada");
  const inUse = await tenantPool(tenant).query("SELECT 1 FROM users WHERE area_id = $1 LIMIT 1", [id]);
  if (inUse.rowCount || area.categories) {
    throw new HttpError(409, "No se puede eliminar un área con usuarios o categorías asociadas");
  }
  await tenantPool(tenant).query("DELETE FROM areas WHERE id = $1", [id]);
  return area.name;
}

/**
 * Ajusta, desde el área, las categorías que tiene a cargo (category_areas). Solo permite quitar: autorizar un área
 * en una categoría es decisión de Categorías.
 */
export async function setAreaCategories(
  tenant: Tenant,
  areaId: string,
  categoryIds: string[],
): Promise<{ area: string; added: string[]; removed: string[] }> {
  return inTransaction(tenant, async (db) => {
    const area = (await db.query<{ name: string }>("SELECT name FROM areas WHERE id = $1", [areaId])).rows[0];
    if (!area) throw new HttpError(404, "Área no encontrada");

    const restricted = (await db.query<Category>(`SELECT ${CATEGORY_COLUMNS} FROM categories c`)).rows;
    const wanted = new Set(categoryIds);
    const unknown = categoryIds.filter((id) => !restricted.some((c) => c.id === id));
    if (unknown.length) throw new HttpError(400, "Alguna de las categorías no existe");

    const added: string[] = [];
    const removed: string[] = [];
    for (const c of restricted) {
      const has = c.area_ids.includes(areaId);
      if (wanted.has(c.id) && !has) {
        // La exclusividad se define en Categorías: desde el área no se puede sumar a una categoría reservada a otras.
        throw new HttpError(
          403,
          `"${c.name}" no está autorizada para ${area.name}. Las áreas de cada categoría se definen en Categorías.`,
        );
      } else if (!wanted.has(c.id) && has) {
        // Quitar la última área dejaría la categoría sin nadie que la gestione: no se permite desde aquí.
        if (c.area_ids.length === 1) {
          throw new HttpError(
            409,
            `"${c.name}" quedaría sin áreas y nadie podría gestionar sus denuncias. Autoriza otra área primero desde Categorías.`,
          );
        }
        await db.query("DELETE FROM category_areas WHERE category_id = $1 AND area_id = $2", [c.id, areaId]);
        // Las personas del área que la tenían asignada explícitamente dejan de tenerla.
        await db.query(
          `DELETE FROM user_categories uc USING users u
           WHERE uc.user_id = u.id AND uc.category_id = $1 AND u.area_id = $2`,
          [c.id, areaId],
        );
        removed.push(c.name);
      }
    }
    return { area: area.name, added, removed };
  });
}

/* ------------------------------------------------------------------ Usuarios */

export async function listUsers(tenant: Tenant): Promise<ChannelUser[]> {
  const res = await tenantPool(tenant).query<ChannelUser>(
    `SELECT ${USER_COLUMNS} FROM ${USER_FROM} ORDER BY u.is_active DESC, u.name`,
  );
  return res.rows;
}

export async function getUser(tenant: Tenant, id: string): Promise<ChannelUser> {
  const res = await tenantPool(tenant).query<ChannelUser>(`SELECT ${USER_COLUMNS} FROM ${USER_FROM} WHERE u.id = $1`, [id]);
  if (!res.rows[0]) throw new HttpError(404, "Usuario no encontrado");
  return res.rows[0];
}

interface UserScope {
  allCategories: boolean;
  categoryIds: string[];
}

/**
 * Normaliza y valida el alcance: solo los roles que trabajan denuncias se acotan a
 * categorías, y cada categoría asignada debe autorizar el área de la persona.
 */
async function resolveScope(
  db: pg.PoolClient,
  roles: readonly TenantRole[],
  areaId: string | null,
  scope: UserScope,
): Promise<UserScope> {
  if (!hasScopedRole(roles)) return { allCategories: true, categoryIds: [] };
  if (!areaId) throw new HttpError(400, "Asigna un área antes de darle categorías a cargo");
  if (scope.allCategories) return { allCategories: true, categoryIds: [] };

  const ids = [...new Set(scope.categoryIds)];
  if (!ids.length) throw new HttpError(400, "Selecciona al menos una categoría o marca «Todas las categorías»");
  const found = await db.query<Category>(`SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.id = ANY($1::uuid[])`, [ids]);
  if (found.rowCount !== ids.length) throw new HttpError(400, "Alguna de las categorías seleccionadas no existe");

  const notAllowed = found.rows.filter((c) => !areaAllowed(c, areaId));
  if (notAllowed.length) {
    throw new HttpError(
      400,
      `Su área no está autorizada para: ${notAllowed.map((c) => c.name).join(", ")}. Revisa las áreas autorizadas en Categorías.`,
    );
  }
  return { allCategories: false, categoryIds: ids };
}

async function saveScope(db: pg.PoolClient, userId: string, scope: UserScope) {
  await db.query("UPDATE users SET all_categories = $2 WHERE id = $1", [userId, scope.allCategories]);
  await db.query("DELETE FROM user_categories WHERE user_id = $1", [userId]);
  if (scope.categoryIds.length) {
    await db.query("INSERT INTO user_categories (user_id, category_id) SELECT $1, unnest($2::uuid[])", [
      userId,
      scope.categoryIds,
    ]);
  }
}

export interface NewChannelUser extends UserScope {
  name: string;
  email: string;
  roles: TenantRole[];
  areaId: string;
}

/** Crea un usuario con contraseña temporal (deberá cambiarla y configurar 2FA al ingresar). */
export async function createUser(
  tenant: Tenant,
  input: NewChannelUser,
): Promise<{ user: ChannelUser; credentials: IssuedCredentials }> {
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);
  try {
    const id = await inTransaction(tenant, async (db) => {
      await ensureArea(db, input.areaId);
      const scope = await resolveScope(db, input.roles, input.areaId, input);
      const res = await db.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, roles, area_id, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [input.email, input.name, hash, [...new Set(input.roles)], input.areaId],
      );
      await saveScope(db, res.rows[0]!.id, scope);
      return res.rows[0]!.id;
    });
    return { user: await getUser(tenant, id), credentials: { email: input.email, temporaryPassword } };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe un usuario con el email ${input.email}`);
    throw err;
  }
}

export type UserChanges = Partial<Pick<NewChannelUser, "name" | "roles" | "areaId" | "allCategories" | "categoryIds">>;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Actualiza nombre, rol, área y/o alcance. Devuelve qué cambió (para la auditoría). */
export async function updateUser(tenant: Tenant, id: string, changes: UserChanges): Promise<string[]> {
  const before = await getUser(tenant, id);
  const changed: string[] = [];

  await inTransaction(tenant, async (db) => {
    const roles = changes.roles ? [...new Set(changes.roles)] : before.roles;
    const areaId = changes.areaId ?? before.area_id;
    if (changes.areaId) await ensureArea(db, changes.areaId);

    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [field, column] of [
      ["name", "name"],
      ["areaId", "area_id"],
    ] as const) {
      if (changes[field] === undefined || changes[field] === before[column]) continue;
      params.push(changes[field]);
      sets.push(`${column} = $${params.length}`);
      changed.push(field === "areaId" ? "area" : field);
    }
    if (changes.roles && !sameSet(roles, before.roles)) {
      params.push(roles);
      sets.push(`roles = $${params.length}`);
      changed.push("roles");
    }
    if (sets.length) await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, params);

    // El alcance se revalida si cambió el rol, el área o se envió uno nuevo.
    if (
      changes.roles !== undefined ||
      changes.areaId !== undefined ||
      changes.allCategories !== undefined ||
      changes.categoryIds !== undefined
    ) {
      const scope = await resolveScope(db, roles, areaId, {
        allCategories: changes.allCategories ?? before.all_categories,
        categoryIds: changes.categoryIds ?? before.category_ids,
      });
      const sameScope =
        scope.allCategories === before.all_categories &&
        scope.categoryIds.length === before.category_ids.length &&
        scope.categoryIds.every((c) => before.category_ids.includes(c));
      if (!sameScope) {
        await saveScope(db, id, scope);
        changed.push("categories");
      }
    }
  });
  return changed;
}

export async function countActiveAdmins(tenant: Tenant): Promise<number> {
  const res = await tenantPool(tenant).query<{ count: string }>(
    "SELECT count(*) FROM users WHERE 'client_admin' = ANY(roles) AND is_active",
  );
  return Number(res.rows[0]!.count);
}

/* ------------------------------------------------------------------ Categorías */

export async function listCategories(tenant: Tenant): Promise<Category[]> {
  const res = await tenantPool(tenant).query<Category>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories c ORDER BY c.sort_order, c.name`,
  );
  return res.rows;
}

/** Categorías con la cantidad de responsables activos que efectivamente pueden verlas. */
export async function listCategoriesWithCoverage(tenant: Tenant): Promise<(Category & { assigned_users: number })[]> {
  const [categories, users] = await Promise.all([listCategories(tenant), listUsers(tenant)]);
  const active = users.filter((u) => u.is_active);
  return categories.map((c) => ({
    ...c,
    assigned_users: active.filter((u) => effectiveCategories(u, [c]).length > 0).length,
  }));
}

export interface CategoryInput {
  name: string;
  description: string | null;
  legalFramework: LegalFramework;
  areaIds: string[];
  isActive?: boolean;
}

async function saveCategoryAreas(db: pg.PoolClient, categoryId: string, areaIds: string[]) {
  const ids = [...new Set(areaIds)];
  if (ids.length) {
    const found = await db.query("SELECT id FROM areas WHERE id = ANY($1::uuid[])", [ids]);
    if (found.rowCount !== ids.length) throw new HttpError(400, "Alguna de las áreas seleccionadas no existe");
  }
  await db.query("DELETE FROM category_areas WHERE category_id = $1", [categoryId]);
  if (ids.length) {
    await db.query("INSERT INTO category_areas (category_id, area_id) SELECT $1, unnest($2::uuid[])", [categoryId, ids]);
    // Quien estaba asignado explícitamente y ya no es de un área autorizada, deja de tenerla.
    await db.query(
      `DELETE FROM user_categories uc USING users u
       WHERE uc.user_id = u.id AND uc.category_id = $1
         AND (u.area_id IS NULL OR NOT (u.area_id = ANY($2::uuid[])))`,
      [categoryId, ids],
    );
  }
}

async function getCategory(db: pg.PoolClient | pg.Pool, id: string): Promise<Category> {
  const res = await db.query<Category>(`SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.id = $1`, [id]);
  if (!res.rows[0]) throw new HttpError(404, "Categoría no encontrada");
  return res.rows[0];
}

export async function createCategory(tenant: Tenant, input: CategoryInput): Promise<Category> {
  try {
    return await inTransaction(tenant, async (db) => {
      const res = await db.query<{ id: string }>(
        `INSERT INTO categories (name, description, legal_framework, sort_order)
         VALUES ($1, $2, $3, (SELECT COALESCE(max(sort_order), 0) + 10 FROM categories))
         RETURNING id`,
        [input.name, input.description, input.legalFramework],
      );
      await saveCategoryAreas(db, res.rows[0]!.id, input.areaIds);
      return getCategory(db, res.rows[0]!.id);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe una categoría llamada "${input.name}"`);
    throw err;
  }
}

export async function updateCategory(
  tenant: Tenant,
  id: string,
  input: Partial<CategoryInput>,
): Promise<{ category: Category; changed: string[] }> {
  try {
    return await inTransaction(tenant, async (db) => {
      const current = await getCategory(db, id);
      const map = { name: "name", description: "description", legalFramework: "legal_framework", isActive: "is_active" } as const;
      const sets: string[] = [];
      const params: unknown[] = [id];
      const changed: string[] = [];
      for (const [key, column] of Object.entries(map) as [keyof typeof map, (typeof map)[keyof typeof map]][]) {
        if (input[key] === undefined || input[key] === current[column]) continue;
        params.push(input[key]);
        sets.push(`${column} = $${params.length}`);
        changed.push(key);
      }
      if (sets.length) {
        await db.query(`UPDATE categories SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
      }
      if (input.areaIds !== undefined) {
        const next = [...new Set(input.areaIds)];
        const same = next.length === current.area_ids.length && next.every((a) => current.area_ids.includes(a));
        if (!same) {
          await saveCategoryAreas(db, id, next);
          changed.push("areas");
        }
      }
      return { category: await getCategory(db, id), changed };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `Ya existe una categoría llamada "${input.name}"`);
    throw err;
  }
}

/* ------------------------------------------------------------------ Ajustes */

export async function getSettings(tenant: Tenant): Promise<{ portal: PortalSettings; caseRules: CaseRules }> {
  const res = await tenantPool(tenant).query<{ key: string; value: unknown }>(
    "SELECT key, value FROM settings WHERE key IN ('portal', 'case_rules')",
  );
  const byKey = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
  const rules = (byKey.case_rules ?? {}) as Partial<CaseRules>;
  return {
    portal: { reportEmail: null, phone: null, inPerson: null, ...(byKey.portal as Partial<PortalSettings>) } as PortalSettings,
    caseRules: {
      mode: rules.mode ?? "complete",
      retentionMonths: rules.retentionMonths ?? 60,
      conflictPlan: { substituteUserId: null, externalContact: null, ...rules.conflictPlan },
    },
  };
}

export async function saveSetting(tenant: Tenant, key: "portal" | "case_rules" | "branding", value: object, userId: string) {
  await tenantPool(tenant).query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, value, userId],
  );
}

/* ------------------------------------------------------------------ Resumen */

/** Datos del inicio del client_admin: equipo, cobertura de categorías y puesta en marcha. */
export async function getChannelOverview(tenant: Tenant) {
  const [users, allCategories, settings, plan] = await Promise.all([
    listUsers(tenant),
    listCategories(tenant),
    getSettings(tenant),
    planOf(tenant),
  ]);
  // Solo cuentan las categorías de marcos que incluye el plan (las otras no se muestran ni reciben denuncias).
  const categories = allCategories.filter((c) => hasFramework(plan, c.legal_framework));
  const active = users.filter((u) => u.is_active);
  const byRole = (role: TenantRole) => active.filter((u) => u.roles.includes(role)).length;
  const { mode, conflictPlan } = settings.caseRules;
  const caseHandlers = active.filter((u) => hasScopedRole(u.roles));
  const substitute = active.find((u) => u.id === conflictPlan.substituteUserId && hasScopedRole(u.roles));
  const activeCategories = categories.filter((c) => c.is_active);

  // Una categoría está cubierta si al menos un gestor activo puede verla efectivamente.
  const managers = active.filter((u) => u.roles.includes("case_manager"));
  const uncovered = activeCategories.filter((c) => !managers.some((m) => effectiveCategories(m, [c]).length > 0));
  const withoutArea = active.filter((u) => !u.area_id);

  const checklist = [
    {
      key: "areas",
      done: withoutArea.length === 0,
      title: "Asignar un área a cada usuario",
      detail: withoutArea.length
        ? `Sin área: ${withoutArea.map((u) => u.name).join(", ")}.`
        : "El área define qué categorías puede tener cada persona a cargo.",
      to: "users",
    },
    {
      key: "case_manager",
      done: byRole("case_manager") > 0,
      title: "Designar al menos un gestor de denuncias",
      detail: "Recibe las denuncias nuevas, las clasifica y asigna al investigador.",
      to: "users",
    },
    {
      key: "coverage",
      done: managers.length > 0 && uncovered.length === 0,
      title: "Cubrir todas las categorías con un gestor de un área autorizada",
      detail: uncovered.length
        ? `Sin gestor: ${uncovered.map((c) => c.name).join(", ")}.`
        : "Cada categoría activa tiene a alguien que recibirá sus denuncias.",
      to: "users",
    },
    {
      key: "investigator",
      done: byRole("investigator") > 0,
      title: "Designar quién investiga",
      detail:
        mode === "simplified"
          ? "Puede ser la misma persona que gestiona: márcale también el rol Investigador."
          : "Por ejemplo, personas de Recursos Humanos para los casos de Ley Karin.",
      to: "users",
    },
    {
      key: "resolver",
      done: byRole("resolver") > 0,
      title: "Designar quién cierra los casos",
      detail:
        mode === "simplified"
          ? "Puede ser la misma persona: márcale también el rol Comité / Resolutor."
          : "Aprueba el cierre de los casos que investigó otra persona.",
      to: "users",
    },
    ...(mode === "complete"
      ? [
          {
            key: "two_people",
            done: caseHandlers.length >= 2,
            title: "Contar con al menos dos personas que gestionen denuncias",
            detail: "La doble aprobación exige que quien investiga y quien cierra un caso sean personas distintas.",
            to: "users",
          },
        ]
      : [
          {
            key: "conflict_plan",
            done: Boolean(substitute || conflictPlan.externalContact),
            title: "Definir el plan ante conflicto de interés",
            detail: "A quién llega una denuncia que involucra a la persona encargada: un suplente o un contacto externo.",
            to: "settings",
          },
        ]),
    {
      key: "policy",
      done: settings.portal.policy.trim().length > 0,
      title: "Publicar la política del canal",
      detail: "Texto que verá el denunciante: alcance, confidencialidad y no represalias.",
      to: "portal",
    },
  ];

  return {
    users: {
      total: active.length,
      byRole: {
        client_admin: byRole("client_admin"),
        case_manager: byRole("case_manager"),
        investigator: byRole("investigator"),
        resolver: byRole("resolver"),
        auditor: byRole("auditor"),
      },
      mfaPending: active.filter((u) => !u.mfa_enabled).length,
      passwordPending: active.filter((u) => u.must_change_password).length,
      withoutArea: withoutArea.length,
    },
    categories: {
      active: activeCategories.length,
      total: categories.length,
      leyKarin: activeCategories.filter((c) => c.legal_framework === "ley_karin").length,
      uncovered: uncovered.map((c) => ({ id: c.id, name: c.name })),
    },
    portal: { allowAnonymous: settings.portal.allowAnonymous, hasPolicy: settings.portal.policy.trim().length > 0 },
    caseRules: settings.caseRules,
    checklist,
  };
}
