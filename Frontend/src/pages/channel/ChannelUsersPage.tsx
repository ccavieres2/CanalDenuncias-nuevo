import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AccountBadges } from "../../components/AccountBadges";
import { ConfirmModal, CredentialsModal, RowMenu } from "../../components/dialogs";
import {
  Alert,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  EmptyState,
  Field,
  Icon,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Toggle,
  td,
  th,
} from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useChannel } from "../../lib/channel-context";
import {
  type Area,
  type CaseRules,
  type Category,
  type ChannelMember,
  type ChannelMode,
  areaAllowed,
} from "../../lib/channel-types";
import { FRAMEWORKS, ROLES, ROLE_ORDER, SCOPED_ROLES, type TenantRole, hasScopedRole, roleCombinationError, FRAMEWORK_ORDER } from "../../lib/roles";
import type { Credentials } from "../../lib/types";
import { formatDate, initials } from "../../lib/ui-helpers";

type Pending =
  | { kind: "toggle"; member: ChannelMember }
  | { kind: "reset-password"; member: ChannelMember }
  | { kind: "reset-mfa"; member: ChannelMember };

const WARN = { styles: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" };

/** Categorías que la persona ve efectivamente: asignadas (o todas) y autorizadas para su área. */
function effective(
  m: Pick<ChannelMember, "roles" | "all_categories" | "category_ids" | "area_id">,
  categories: Category[],
) {
  if (!hasScopedRole(m.roles)) return [];
  return categories.filter(
    (c) => c.is_active && (m.all_categories || m.category_ids.includes(c.id)) && areaAllowed(c, m.area_id),
  );
}

export function ChannelUsersPage() {
  const { user: me, token, apiBase, basePath, logout, tenant } = useChannel();
  const [members, setMembers] = useState<ChannelMember[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [roleFilter, setRoleFilter] = useState<TenantRole | "">("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ChannelMember | "new" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [issued, setIssued] = useState<{ title: string; credentials: Credentials } | null>(null);
  const [mode, setMode] = useState<ChannelMode>("complete");

  useEffect(() => {
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return logout();
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    };
    api<{ users: ChannelMember[] }>(`${apiBase}/console/users`, { token })
      .then((res) => setMembers(res.users))
      .catch(onError);
    api<{ categories: Category[] }>(`${apiBase}/console/categories`, { token })
      .then((res) => setCategories(res.categories))
      .catch(onError);
    api<{ areas: Area[] }>(`${apiBase}/console/areas`, { token })
      .then((res) => setAreas(res.areas))
      .catch(onError);
    api<{ caseRules: CaseRules }>(`${apiBase}/console/settings`, { token })
      .then((res) => setMode(res.caseRules.mode))
      .catch(onError);
  }, [apiBase, token, logout, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const activeCategories = useMemo(() => categories.filter((c) => c.is_active), [categories]);

  const q = query.trim().toLowerCase();
  const visible =
    members?.filter(
      (m) =>
        (!roleFilter || m.roles.includes(roleFilter)) &&
        (!q || m.name.toLowerCase().includes(q) || m.email.includes(q) || (m.area ?? "").toLowerCase().includes(q)),
    ) ?? [];
  const countByRole = (role: TenantRole) => members?.filter((m) => m.roles.includes(role) && m.is_active).length ?? 0;
  const withoutArea = members?.filter((m) => m.is_active && !m.area_id) ?? [];

  const actionsFor = (m: ChannelMember) => {
    const self = m.id === me.id;
    return [
      { label: "Editar roles, área y categorías", onSelect: () => setEditing(m) },
      {
        label: "Restablecer contraseña",
        onSelect: () => setPending({ kind: "reset-password", member: m }),
        hidden: self,
      },
      {
        label: "Restablecer verificación en dos pasos",
        onSelect: () => setPending({ kind: "reset-mfa", member: m }),
        hidden: self || !m.mfa_enabled,
      },
      {
        label: m.is_active ? "Desactivar acceso" : "Reactivar acceso",
        onSelect: () => setPending({ kind: "toggle", member: m }),
        danger: m.is_active,
        hidden: self,
      },
    ];
  };

  /** Texto de la columna "Categorías". */
  const scope = (m: ChannelMember): { text: string; warn?: boolean } => {
    if (!hasScopedRole(m.roles)) {
      return m.roles.includes("auditor") ? { text: "Todas (solo lectura)" } : { text: "No gestiona denuncias" };
    }
    const list = effective(m, activeCategories);
    if (!list.length) return { text: m.area_id ? "Sin categorías a cargo" : "Requiere un área", warn: true };
    if (list.length === activeCategories.length) return { text: "Todas las categorías" };
    if (m.all_categories) return { text: `Todas las autorizadas para su área (${list.length})` };
    const names = list.map((c) => c.name);
    return { text: names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} y ${names.length - 2} más` };
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: basePath }, { label: "Usuarios y roles" }]} />
      <PageHeader
        title="Usuarios y roles"
        description="Personas que participan en el canal. Una persona puede tener varios roles y elige con cuál trabajar al ingresar; el área y las categorías definen qué denuncias podrá ver."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} className="w-full sm:w-auto">
            <Icon name="plus" />
            Agregar usuario
          </Button>
        }
      />

      {(flash || error || withoutArea.length > 0) && (
        <div className="mb-6 space-y-3">
          {flash && <Alert type="success">{flash}</Alert>}
          {error && <Alert>{error}</Alert>}
          {withoutArea.length > 0 && (
            <Alert type="info">
              {withoutArea.length === 1 ? "Una persona no tiene" : `${withoutArea.length} personas no tienen`} área
              asignada ({withoutArea.map((m) => m.name).join(", ")}). Asígnala desde el menú de acciones para que pueda
              tener categorías a cargo.
            </Alert>
          )}
        </div>
      )}

      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          flush
          title="Usuarios"
          counter={members ? visible.length : undefined}
          toolbar={
            <div className="space-y-4">
              <SearchInput value={query} onChange={setQuery} placeholder="Buscar por nombre, email o área" />
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {(["", ...ROLE_ORDER] as const).map((role) => (
                  <button
                    key={role || "all"}
                    onClick={() => setRoleFilter(role)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                      roleFilter === role
                        ? "bg-accent text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                    }`}
                  >
                    {role ? ROLES[role].short : "Todos"}
                    {role && <span className="ml-1.5 opacity-70">{countByRole(role)}</span>}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {members === null ? (
            <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando usuarios…</p>
          ) : visible.length === 0 ? (
            <EmptyState title="Sin resultados" description="Ningún usuario coincide con los filtros." />
          ) : (
            <>
              <div className="relative hidden overflow-x-auto md:block">
                <table className="min-w-full">
                  <thead className="border-b border-line-soft bg-gray-50/70">
                    <tr>
                      <th className={th}>Usuario</th>
                      <th className={th}>Rol y área</th>
                      <th className={`${th} hidden xl:table-cell`}>Categorías</th>
                      <th className={th}>Estado</th>
                      <th className={`${th} hidden 2xl:table-cell`}>Último acceso</th>
                      <th className={th}>
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {visible.map((m) => {
                      const s = scope(m);
                      return (
                        <tr key={m.id} className={`transition hover:bg-gray-50/70 ${m.is_active ? "" : "opacity-60"}`}>
                          <td className={td}>
                            <div className="flex items-center gap-3">
                              <Avatar label={initials(m.name)} className="size-9 text-xs" />
                              <div>
                                <p className="font-medium text-gray-900">
                                  {m.name}
                                  {m.id === me.id && (
                                    <span className="ml-2 text-xs font-normal text-gray-500">(tú)</span>
                                  )}
                                </p>
                                <p className="text-gray-500">{m.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className={`${td} whitespace-normal`}>
                            <RoleChips roles={m.roles} />
                            <div className="mt-1.5">
                              {m.area ? (
                                <p className="text-gray-500">{m.area}</p>
                              ) : (
                                <Badge {...WARN} label="Sin área" />
                              )}
                            </div>
                          </td>
                          <td className={`${td} hidden max-w-64 truncate xl:table-cell`} title={s.text}>
                            <span className={s.warn ? "text-amber-700" : "text-gray-600"}>{s.text}</span>
                          </td>
                          <td className={`${td} whitespace-normal`}>
                            <AccountBadges account={m} />
                          </td>
                          <td className={`${td} hidden text-gray-500 2xl:table-cell`}>
                            {formatDate(m.last_login_at, true)}
                          </td>
                          <td className={`${td} w-px text-right`}>
                            <RowMenu actions={actionsFor(m)} label={`Acciones para ${m.name}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-line-soft md:hidden">
                {visible.map((m) => {
                  const s = scope(m);
                  return (
                    <li key={m.id} className={`flex items-start gap-3 px-4 py-4 ${m.is_active ? "" : "opacity-60"}`}>
                      <Avatar label={initials(m.name)} className="size-10 text-xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900">
                          {m.name}
                          {m.id === me.id && <span className="ml-1.5 text-xs font-normal text-gray-500">(tú)</span>}
                        </p>
                        <p className="truncate text-sm text-gray-500">{m.email}</p>
                        <div className="mt-2">
                          <RoleChips roles={m.roles} />
                        </div>
                        {m.area && <p className="mt-1.5 text-sm text-gray-500">{m.area}</p>}
                        <p className={`truncate text-xs ${s.warn ? "text-amber-700" : "text-gray-500"}`}>{s.text}</p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {!m.area_id && <Badge {...WARN} label="Sin área" />}
                          <AccountBadges account={m} />
                        </div>
                      </div>
                      <RowMenu actions={actionsFor(m)} label={`Acciones para ${m.name}`} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Guía de roles" description="Separación de funciones recomendada por la Ley Karin y la ISO 37002.">
          <ul className="space-y-5">
            {ROLE_ORDER.map((role) => (
              <li key={role}>
                <p className="text-sm font-semibold text-gray-900">{ROLES[role].label}</p>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">{ROLES[role].description}</p>
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                  <Icon name="eye" className="size-3.5" />
                  {ROLES[role].seesCases}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {editing && (
        <UserFormModal
          member={editing === "new" ? null : editing}
          isSelf={editing !== "new" && editing.id === me.id}
          categories={activeCategories}
          areas={areas}
          mode={mode}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            setEditing(null);
            if (result.credentials) {
              setIssued({ title: `Acceso creado para ${result.member.name}`, credentials: result.credentials });
            } else {
              setFlash(`Se actualizó a ${result.member.name}.`);
            }
            reload();
          }}
        />
      )}

      {issued && <CredentialsModal {...issued} loginUrl={`/${tenant.slug}/login`} onClose={() => setIssued(null)} />}

      {pending?.kind === "toggle" && (
        <ConfirmModal
          title={
            pending.member.is_active ? `¿Desactivar a ${pending.member.name}?` : `¿Reactivar a ${pending.member.name}?`
          }
          confirmLabel={pending.member.is_active ? "Desactivar" : "Reactivar"}
          danger={pending.member.is_active}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api(`${apiBase}/console/users/${pending.member.id}`, {
              method: "PATCH",
              token,
              body: { isActive: !pending.member.is_active },
            });
            setFlash(
              pending.member.is_active
                ? `${pending.member.name} ya no tiene acceso al canal.`
                : `${pending.member.name} vuelve a tener acceso al canal.`,
            );
            setPending(null);
            reload();
          }}
        >
          {pending.member.is_active ? (
            <p>
              Perderá el acceso de inmediato, incluso si tiene una sesión abierta. Su historial se conserva. Si tiene
              denuncias asignadas, deberán reasignarse.
            </p>
          ) : (
            <p>Podrá volver a ingresar con su contraseña y verificación en dos pasos actuales.</p>
          )}
        </ConfirmModal>
      )}

      {pending?.kind === "reset-password" && (
        <ConfirmModal
          title="Restablecer contraseña"
          confirmLabel="Generar contraseña temporal"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const res = await api<{ credentials: Credentials }>(
              `${apiBase}/console/users/${pending.member.id}/reset-password`,
              { method: "POST", token },
            );
            setIssued({ title: `Nueva contraseña para ${pending.member.name}`, credentials: res.credentials });
            setPending(null);
            reload();
          }}
        >
          <p>
            Se generará una contraseña temporal para <strong className="text-gray-900">{pending.member.email}</strong> y
            se cerrarán sus sesiones abiertas. Deberá cambiarla al ingresar.
          </p>
        </ConfirmModal>
      )}

      {pending?.kind === "reset-mfa" && (
        <ConfirmModal
          title="Restablecer verificación en dos pasos"
          confirmLabel="Restablecer"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api(`${apiBase}/console/users/${pending.member.id}/reset-mfa`, { method: "POST", token });
            setFlash(`Se restableció la verificación en dos pasos de ${pending.member.name}.`);
            setPending(null);
            reload();
          }}
        >
          <p>
            Se desvinculará la app de autenticación de <strong className="text-gray-900">{pending.member.name}</strong>.
            En su próximo ingreso deberá escanear un nuevo código QR. Hazlo solo tras confirmar su identidad.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Crear / editar usuario */


function UserFormModal({
  member,
  isSelf,
  categories,
  areas,
  mode,
  onClose,
  onSaved,
}: {
  member: ChannelMember | null;
  isSelf: boolean;
  /** Solo categorías activas. */
  categories: Category[];
  areas: Area[];
  mode: ChannelMode;
  onClose: () => void;
  onSaved: (result: { member: ChannelMember; credentials?: Credentials }) => void;
}) {
  const { token, apiBase, basePath } = useChannel();
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<TenantRole[]>(member?.roles ?? ["investigator"]);
  const [areaId, setAreaId] = useState(member?.area_id ?? "");
  const [allCategories, setAllCategories] = useState(member?.all_categories ?? true);
  const [categoryIds, setCategoryIds] = useState<string[]>(member?.category_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const scoped = hasScopedRole(roles);
  const combinationError = roleCombinationError(roles, mode);
  const isLead = SCOPED_ROLES.every((r) => roles.includes(r));

  function toggleRole(r: TenantRole) {
    // Una persona no puede quitarse a sí misma el rol de administrador.
    if (isSelf && r === "client_admin") return;
    setRoles((current) => (current.includes(r) ? current.filter((x) => x !== r) : [...current, r]));
  }

  /** Atajo para empresas pequeñas: gestor + investigador + resolutor en una persona. */
  function makeLead() {
    setRoles((current) => [...new Set([...current.filter((r) => r !== "auditor"), ...SCOPED_ROLES])]);
  }
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const allowedForArea = categories.filter((c) => areaAllowed(c, areaId || null));
  const selected = allCategories ? allowedForArea : allowedForArea.filter((c) => categoryIds.includes(c.id));

  const toggleCategory = (id: string) =>
    setCategoryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  /** Al cambiar de área se quitan las categorías que la nueva área no puede tener. */
  function changeArea(next: string) {
    setAreaId(next);
    setCategoryIds((ids) =>
      ids.filter((id) => {
        const c = categories.find((x) => x.id === id);
        return c ? areaAllowed(c, next || null) : false;
      }),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!areaId) {
      setFields({ areaId: "Selecciona un área" });
      return;
    }
    if (!roles.length) {
      setError("Selecciona al menos un rol.");
      return;
    }
    if (combinationError) {
      setError(combinationError);
      return;
    }
    setLoading(true);
    const body = {
      name,
      roles,
      areaId,
      allCategories: !scoped || allCategories,
      categoryIds: scoped && !allCategories ? categoryIds.filter((id) => allowedForArea.some((c) => c.id === id)) : [],
    };
    try {
      if (member) {
        const res = await api<{ user: ChannelMember }>(`${apiBase}/console/users/${member.id}`, {
          method: "PATCH",
          token,
          body,
        });
        onSaved({ member: res.user });
      } else {
        const res = await api<{ user: ChannelMember; credentials: Credentials }>(`${apiBase}/console/users`, {
          method: "POST",
          token,
          body: { ...body, email },
        });
        onSaved({ member: res.user, credentials: res.credentials });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      setLoading(false);
    }
  }

  return (
    <Modal
      size="xl"
      title={member ? `Editar a ${member.name}` : "Agregar usuario"}
      description={
        member
          ? member.email
          : "Se generará una contraseña temporal y deberá configurar la verificación en dos pasos al ingresar."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form" variant="primary" loading={loading}>
            {member ? "Guardar cambios" : "Crear usuario"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-8">
        {error && <Alert>{error}</Alert>}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Datos de la persona */}
          <section className="space-y-5">
            <SectionTitle step={1} title="Datos de la persona" />
            <Field
              label="Nombre completo"
              required
              autoFocus
              value={name}
              error={fields.name}
              onChange={(e) => setName(e.target.value)}
            />
            {!member && (
              <Field
                label="Correo electrónico"
                type="email"
                required
                value={email}
                error={fields.email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            <label className="block">
              <span className="block text-sm font-medium text-gray-800">Área</span>
              <span className="mt-0.5 block text-sm text-gray-500">
                Define qué categorías de denuncia puede tener a cargo.
              </span>
              <div className="mt-2">
                <Select value={areaId} onChange={changeArea} aria-label="Área" aria-invalid={!!fields.areaId}>
                  <option value="">Selecciona un área…</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              {fields.areaId ? (
                <span className="mt-1.5 flex items-center gap-1.5 text-sm text-red-600">
                  <Icon name="error" className="size-4 shrink-0" />
                  {fields.areaId}
                </span>
              ) : (
                <span className="mt-1.5 block text-sm text-gray-500">
                  ¿No está en la lista?{" "}
                  <Link to={`${basePath}/areas`} className="font-medium text-accent hover:underline">
                    Administrar áreas
                  </Link>
                </span>
              )}
            </label>
          </section>

          {/* Roles */}
          <section>
            <SectionTitle
              step={2}
              title="Roles en el canal"
              right={
                mode === "simplified" &&
                !isLead && (
                  <button type="button" onClick={makeLead} className="text-sm font-medium text-accent hover:underline">
                    Hacer encargado del canal
                  </button>
                )
              }
            />
            <p className="mt-2 text-sm text-gray-500">
              Puede tener varios. Al ingresar elegirá con cuál trabajar.
              {mode === "simplified"
                ? " En la modalidad simplificada una persona puede llevar todo el proceso."
                : " En la modalidad completa, administrar y auditar no se combinan con gestionar denuncias."}
            </p>
            <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Roles</legend>
              {ROLE_ORDER.map((r) => {
                const checked = roles.includes(r);
                const locked = isSelf && r === "client_admin";
                const blocked = !checked && roleCombinationError([...roles, r], mode) !== null;
                return (
                  <label
                    key={r}
                    title={
                      locked
                        ? "No puedes quitarte el rol de administrador"
                        : blocked
                          ? "No se puede combinar en la modalidad completa"
                          : undefined
                    }
                    className={`flex items-start gap-3 rounded-lg p-3 ring-1 transition ring-inset ${
                      checked ? "bg-accent-soft ring-highlight/50" : "ring-line hover:bg-gray-50"
                    } ${locked || blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${r === "client_admin" ? "sm:col-span-2" : ""}`}
                  >
                    <input
                      type="checkbox"
                      name="roles"
                      value={r}
                      checked={checked}
                      disabled={locked || blocked}
                      onChange={() => toggleRole(r)}
                      className="mt-0.5 size-4 rounded accent-brand-navy"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">{ROLES[r].label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{ROLES[r].description}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {combinationError && (
              <div className="mt-3">
                <Alert>{combinationError}</Alert>
              </div>
            )}
          </section>
        </div>

        {/* Categorías */}
        {scoped && (
          <section className="border-t border-line-soft pt-6">
            <SectionTitle
              step={3}
              title="Categorías a su cargo"
              right={
                areaId && (
                  <span className="text-sm text-gray-500">
                    {selected.length} de {categories.length} categorías
                  </span>
                )
              }
            />
            {!areaId ? (
              <div className="mt-4 rounded-lg bg-gray-50 px-4 py-5 text-sm text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                Primero selecciona un área: cada categoría indica qué áreas pueden hacerse cargo de ella (por ejemplo,
                Ley Karin solo Recursos Humanos).
              </div>
            ) : (
              <div className="mt-4 space-y-5">
                <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200/70 ring-inset">
                  <Toggle
                    label="Todas las categorías autorizadas para su área"
                    description={`Verá las ${allowedForArea.length} categorías que ${areaName.get(areaId)} puede tener a cargo, incluidas las que se autoricen en el futuro.`}
                    checked={allCategories}
                    onChange={setAllCategories}
                  />
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                  {FRAMEWORK_ORDER.map((fw) => {
                    const items = categories.filter((c) => c.legal_framework === fw);
                    if (!items.length) return null;
                    return (
                      <div key={fw}>
                        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                          <span className={`size-2 rounded-full ${FRAMEWORKS[fw].dot}`} />
                          {FRAMEWORKS[fw].label}
                        </p>
                        <ul className="mt-3 space-y-2.5">
                          {items.map((c) => {
                            const allowed = areaAllowed(c, areaId);
                            const checked = allowed && (allCategories || categoryIds.includes(c.id));
                            return (
                              <li key={c.id}>
                                <label
                                  className={`flex items-start gap-2.5 text-sm ${
                                    allowed && !allCategories ? "cursor-pointer text-gray-800" : "text-gray-500"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!allowed || allCategories}
                                    onChange={() => toggleCategory(c.id)}
                                    className="mt-0.5 size-4 shrink-0 rounded accent-brand-navy"
                                  />
                                  <span className="min-w-0">
                                    <span className={allowed ? "" : "line-through decoration-gray-300"}>{c.name}</span>
                                    {!allowed && (
                                      <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                                        <Icon name="lock" className="size-3" />
                                        {c.area_ids.length
                                          ? `Solo ${c.area_ids.map((id) => areaName.get(id)).join(", ")}`
                                          : "Sin áreas asignadas (se configura en Categorías)"}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </form>
    </Modal>
  );
}

function SectionTitle({ step, title, right }: { step: number; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold text-gray-900">
        <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-highlight-text">
          {step}
        </span>
        {title}
      </h3>
      {right}
    </div>
  );
}

function RoleChips({ roles }: { roles: TenantRole[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ROLE_ORDER.filter((r) => roles.includes(r)).map((r) => (
        <span key={r} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
          {ROLES[r].short}
        </span>
      ))}
    </div>
  );
}
