import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { AccountBadges } from "../components/AccountBadges";
import { AuditRow } from "../components/AuditRow";
import { ConfirmModal, CredentialsModal, RowMenu } from "../components/dialogs";
import {
  Alert,
  Avatar,
  Breadcrumbs,
  Button,
  EmptyState,
  Field,
  Icon,
  KeyValue,
  Modal,
  PageHeader,
  Panel,
  StatusIndicator,
  TextArea,
  td,
  th,
} from "../components/ui";
import { PlanPicker, PlanSummary } from "../components/PlanPicker";
import { UsagePanel } from "../components/UsagePanel";
import { useAdmin } from "../lib/admin-context";
import type { TenantUsage } from "../lib/usage";
import { type Plan, usePlans } from "../lib/plans";
import { ApiError, api } from "../lib/api";
import type { AuditEvent, ClientAdmin, Credentials, Tenant, TenantProfile } from "../lib/types";
import { buttonClass, formatDate, initials } from "../lib/ui-helpers";

type Pending =
  | { kind: "tenant-status" }
  | { kind: "admin-toggle"; admin: ClientAdmin }
  | { kind: "admin-password"; admin: ClientAdmin }
  | { kind: "admin-mfa"; admin: ClientAdmin };

interface LocationState {
  flash?: string;
  credentials?: Credentials;
}

export function TenantDetailPage() {
  const { slug = "" } = useParams();
  const { token, logout } = useAdmin();
  const location = useLocation();
  const initial = (location.state as LocationState | null) ?? {};
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [admins, setAdmins] = useState<ClientAdmin[] | null>(null);
  const [activity, setActivity] = useState<AuditEvent[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(initial.flash ?? null);
  const [issued, setIssued] = useState<{ title: string; credentials: Credentials } | null>(
    initial.credentials ? { title: "Credenciales del administrador inicial", credentials: initial.credentials } : null,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [changingPlan, setChangingPlan] = useState(false);
  const { plans } = usePlans(token, logout);
  const plan = plans?.find((p) => p.id === tenant?.planId);
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  useEffect(() => {
    api<{ usage: TenantUsage }>(`/admin/tenants/${slug}/usage`, { token })
      .then((res) => setUsage(res.usage))
      .catch(() => undefined);
  }, [slug, token, reloadKey]);

  useEffect(() => {
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return logout();
      if (err instanceof ApiError && err.status === 404) return setNotFound(true);
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    };
    api<{ tenant: Tenant }>(`/admin/tenants/${slug}`, { token })
      .then((res) => setTenant(res.tenant))
      .catch(onError);
    api<{ admins: ClientAdmin[] }>(`/admin/tenants/${slug}/admins`, { token })
      .then((res) => setAdmins(res.admins))
      .catch(onError);
    api<{ events: AuditEvent[] }>(`/admin/audit?tenant=${encodeURIComponent(slug)}&limit=8`, { token })
      .then((res) => setActivity(res.events))
      .catch(() => setActivity([]));
  }, [slug, token, logout, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const crumbs = [
    { label: "Consola", to: "/admin" },
    { label: "Empresas", to: "/admin/tenants" },
    { label: tenant?.name ?? slug },
  ];

  if (notFound) {
    return (
      <>
        <Breadcrumbs items={crumbs} />
        <Panel>
          <EmptyState title="Empresa no encontrada" description={`No existe una empresa con el slug "${slug}".`} />
        </Panel>
      </>
    );
  }

  const isActive = tenant?.status === "active";
  const adminActions = (a: ClientAdmin) => [
    { label: "Restablecer contraseña", onSelect: () => setPending({ kind: "admin-password", admin: a }) },
    {
      label: "Restablecer verificación en dos pasos",
      onSelect: () => setPending({ kind: "admin-mfa", admin: a }),
      hidden: !a.mfa_enabled,
    },
    {
      label: a.is_active ? "Desactivar acceso" : "Reactivar acceso",
      onSelect: () => setPending({ kind: "admin-toggle", admin: a }),
      danger: a.is_active,
    },
  ];

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {tenant?.name ?? "…"}
            {tenant && <StatusIndicator status={tenant.status} />}
          </span>
        }
        description={tenant ? <span className="font-mono text-sm">/{tenant.slug}/login</span> : undefined}
        actions={
          tenant && (
            <>
              <a
                href={`/${tenant.slug}/login`}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("normal", "flex-1 sm:flex-none")}
              >
                Abrir portal
                <Icon name="external" className="size-3.5" />
              </a>
              <Button onClick={() => setEditing(true)} className="flex-1 sm:flex-none">
                <Icon name="pencil" />
                Editar ficha
              </Button>
              {tenant.status !== "provisioning" && (
                <Button
                  variant={isActive ? "danger" : "normal"}
                  onClick={() => setPending({ kind: "tenant-status" })}
                  className="w-full sm:w-auto"
                >
                  {isActive ? "Suspender" : "Reactivar"}
                </Button>
              )}
            </>
          )
        }
      />

      {(flash || error) && (
        <div className="mb-6 space-y-3">
          {flash && (
            <Alert type="success">
              <div className="flex items-start justify-between gap-3">
                <span>{flash}</span>
                <button onClick={() => setFlash(null)} aria-label="Descartar" className="text-emerald-800 hover:text-emerald-950">
                  <Icon name="close" className="size-3.5" />
                </button>
              </div>
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* Columna izquierda: ficha */}
        <div className="space-y-6">
          <Panel
            title={plan ? `Plan ${plan.name}` : "Plan"}
            actions={
              <Button onClick={() => setChangingPlan(true)} disabled={!tenant || !plans}>
                Cambiar plan
              </Button>
            }
          >
            {plan ? <PlanSummary plan={plan} /> : <p className="text-sm text-gray-500">Cargando…</p>}
          </Panel>

          <Panel
            title="Información comercial"
            actions={
              <Button onClick={() => setEditing(true)} aria-label="Editar ficha" title="Editar ficha" className="w-10 px-0">
                <Icon name="pencil" />
              </Button>
            }
          >
            {tenant ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3 xl:grid-cols-1">
                <KeyValue label="Razón social" className="col-span-2 lg:col-span-1">
                  {tenant.legalName ?? <Empty />}
                </KeyValue>
                <KeyValue label="RUT">{tenant.taxId ?? <Empty />}</KeyValue>
                <KeyValue label="Contacto">{tenant.contactName ?? <Empty />}</KeyValue>
                <KeyValue label="Email de contacto" className="col-span-2 lg:col-span-1">
                  {tenant.contactEmail ? (
                    <a href={`mailto:${tenant.contactEmail}`} className="break-all text-accent hover:underline">
                      {tenant.contactEmail}
                    </a>
                  ) : (
                    <Empty />
                  )}
                </KeyValue>
                <KeyValue label="Teléfono">
                  {tenant.contactPhone ? (
                    <a href={`tel:${tenant.contactPhone.replace(/\s/g, "")}`} className="text-accent hover:underline">
                      {tenant.contactPhone}
                    </a>
                  ) : (
                    <Empty />
                  )}
                </KeyValue>
                {tenant.notes && (
                  <KeyValue label="Notas internas" className="col-span-2 lg:col-span-3 xl:col-span-1">
                    <span className="font-normal whitespace-pre-line text-gray-700">{tenant.notes}</span>
                  </KeyValue>
                )}
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Cargando…</p>
            )}
          </Panel>

          <Panel title="Datos técnicos">
            {tenant ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3 xl:grid-cols-1">
                <KeyValue label="Slug">
                  <span className="font-mono text-[13px]">{tenant.slug}</span>
                </KeyValue>
                <KeyValue label="Base de datos">
                  <span className="font-mono text-[13px]">{tenant.dbName}</span>
                </KeyValue>
                <KeyValue label="Creada">{formatDate(tenant.createdAt, true)}</KeyValue>
                <KeyValue label="Última modificación">{formatDate(tenant.updatedAt, true)}</KeyValue>
                <KeyValue label="ID" className="col-span-2 lg:col-span-1">
                  <span className="font-mono text-[13px] font-normal break-all text-gray-500">{tenant.id}</span>
                </KeyValue>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Cargando…</p>
            )}
          </Panel>
        </div>

        {/* Columna derecha: consumo, administradores y actividad */}
        <div className="min-w-0 space-y-6">
          <UsagePanel usage={usage} />
          <Panel
            flush
            title="Administradores"
            counter={admins?.length}
            description="Usuarios con rol client_admin de esta empresa."
            actions={
              <Button onClick={() => setAddingAdmin(true)}>
                <Icon name="plus" />
                <span className="hidden sm:inline">Agregar administrador</span>
                <span className="sm:hidden">Agregar</span>
              </Button>
            }
          >
            {admins === null ? (
              <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando…</p>
            ) : admins.length === 0 ? (
              <EmptyState title="Sin administradores" description="Esta empresa no tiene administradores registrados." />
            ) : (
              <>
                <div className="relative hidden overflow-x-auto md:block">
                  <table className="min-w-full">
                    <thead className="border-b border-line-soft bg-gray-50/70">
                      <tr>
                        <th className={th}>Usuario</th>
                        <th className={th}>Estado</th>
                        <th className={th}>Último acceso</th>
                        <th className={th}>
                          <span className="sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {admins.map((a) => (
                        <tr key={a.id} className="transition hover:bg-gray-50/70">
                          <td className={td}>
                            <div className="flex items-center gap-3">
                              <Avatar label={initials(a.name)} className="size-9 text-xs" />
                              <div>
                                <p className="font-medium text-gray-900">{a.name}</p>
                                <p className="text-gray-500">{a.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className={`${td} whitespace-normal`}>
                            <AccountBadges account={a} />
                          </td>
                          <td className={`${td} text-gray-500`}>{formatDate(a.last_login_at, true)}</td>
                          <td className={`${td} w-px text-right`}>
                            <RowMenu actions={adminActions(a)} label={`Acciones para ${a.name}`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="divide-y divide-line-soft md:hidden">
                  {admins.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-4">
                      <Avatar label={initials(a.name)} className="size-10 text-xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900">{a.name}</p>
                        <p className="truncate text-sm text-gray-500">{a.email}</p>
                        <div className="mt-2.5">
                          <AccountBadges account={a} />
                        </div>
                        <p className="mt-2 text-xs text-gray-400">Último acceso: {formatDate(a.last_login_at, true)}</p>
                      </div>
                      <RowMenu actions={adminActions(a)} label={`Acciones para ${a.name}`} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            flush
            title="Actividad de la empresa"
            actions={
              <Link to="/admin/audit" className={buttonClass("link", "h-9 px-3")}>
                Ver auditoría
                <Icon name="chevron" className="size-3.5" />
              </Link>
            }
          >
            {activity === null ? (
              <p className="px-6 py-10 text-center text-sm text-gray-500">Cargando…</p>
            ) : activity.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-500">Sin actividad registrada.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {activity.map((e) => (
                  <AuditRow key={e.id} event={e} compact />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* ---------------------------------------------------------------- Diálogos */}

      {issued && tenant && (
        <CredentialsModal {...issued} loginUrl={`/${tenant.slug}/login`} onClose={() => setIssued(null)} />
      )}

      {addingAdmin && (
        <AddAdminModal
          token={token}
          slug={slug}
          onClose={() => setAddingAdmin(false)}
          onCreated={(admin, credentials) => {
            setAddingAdmin(false);
            setIssued({ title: `Acceso creado para ${admin.name}`, credentials });
            reload();
          }}
        />
      )}

      {changingPlan && tenant && plans && (
        <ChangePlanModal
          tenant={tenant}
          plans={plans}
          onClose={() => setChangingPlan(false)}
          onSaved={(t, planName) => {
            setChangingPlan(false);
            setTenant(t);
            setFlash(`La empresa ahora tiene el plan ${planName}.`);
            reload();
          }}
        />
      )}

      {editing && tenant && (
        <EditProfileModal
          token={token}
          tenant={tenant}
          onClose={() => setEditing(false)}
          onSaved={(t) => {
            setEditing(false);
            setTenant(t);
            setFlash("La ficha de la empresa se actualizó.");
            reload();
          }}
        />
      )}

      {pending?.kind === "tenant-status" && tenant && (
        <ConfirmModal
          title={isActive ? `¿Suspender ${tenant.name}?` : `¿Reactivar ${tenant.name}?`}
          confirmLabel={isActive ? "Suspender" : "Reactivar"}
          danger={isActive}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const res = await api<{ tenant: Tenant }>(`/admin/tenants/${tenant.slug}`, {
              method: "PATCH",
              token,
              body: { status: isActive ? "suspended" : "active" },
            });
            setTenant(res.tenant);
            setFlash(res.tenant.status === "active" ? "La empresa fue reactivada." : "La empresa fue suspendida.");
            setPending(null);
            reload();
          }}
        >
          {isActive ? (
            <p>
              Los usuarios de la empresa no podrán iniciar sesión y su portal dejará de estar disponible. Los datos se
              conservan y la empresa puede reactivarse en cualquier momento.
            </p>
          ) : (
            <p>Los usuarios de la empresa podrán volver a iniciar sesión en su portal.</p>
          )}
        </ConfirmModal>
      )}

      {pending?.kind === "admin-toggle" && (
        <ConfirmModal
          title={pending.admin.is_active ? `¿Desactivar a ${pending.admin.name}?` : `¿Reactivar a ${pending.admin.name}?`}
          confirmLabel={pending.admin.is_active ? "Desactivar" : "Reactivar"}
          danger={pending.admin.is_active}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api(`/admin/tenants/${slug}/admins/${pending.admin.id}`, {
              method: "PATCH",
              token,
              body: { isActive: !pending.admin.is_active },
            });
            setFlash(
              pending.admin.is_active
                ? `${pending.admin.name} ya no tiene acceso.`
                : `${pending.admin.name} vuelve a tener acceso.`,
            );
            setPending(null);
            reload();
          }}
        >
          {pending.admin.is_active ? (
            <p>Perderá el acceso de inmediato, incluso si tiene una sesión abierta. Sus datos se conservan.</p>
          ) : (
            <p>Podrá volver a iniciar sesión con su contraseña y verificación en dos pasos actuales.</p>
          )}
        </ConfirmModal>
      )}

      {pending?.kind === "admin-password" && (
        <ConfirmModal
          title="Restablecer contraseña"
          confirmLabel="Generar contraseña temporal"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const res = await api<{ credentials: Credentials }>(
              `/admin/tenants/${slug}/admins/${pending.admin.id}/reset-password`,
              { method: "POST", token },
            );
            setIssued({ title: `Nueva contraseña para ${pending.admin.name}`, credentials: res.credentials });
            setPending(null);
            reload();
          }}
        >
          <p>
            Se generará una contraseña temporal para <strong className="text-gray-900">{pending.admin.email}</strong> y
            se cerrarán sus sesiones abiertas. Deberá cambiarla al ingresar.
          </p>
        </ConfirmModal>
      )}

      {pending?.kind === "admin-mfa" && (
        <ConfirmModal
          title="Restablecer verificación en dos pasos"
          confirmLabel="Restablecer"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api(`/admin/tenants/${slug}/admins/${pending.admin.id}/reset-mfa`, { method: "POST", token });
            setFlash(
              `Se restableció la verificación en dos pasos de ${pending.admin.name}. La configurará en su próximo ingreso.`,
            );
            setPending(null);
            reload();
          }}
        >
          <p>
            Se desvinculará la app de autenticación de <strong className="text-gray-900">{pending.admin.name}</strong> (
            {pending.admin.email}) y se invalidarán sus códigos de recuperación.
          </p>
          <p>
            En su próximo inicio de sesión deberá escanear un nuevo código QR. Hazlo solo después de confirmar la
            identidad de la persona, por ejemplo si perdió su teléfono.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

/**
 * Cambio de plan. Aplica de inmediato y no borra nada: lo que el plan nuevo no incluye deja de mostrarse y de poder
 * crearse, pero lo existente se conserva.
 */
function ChangePlanModal({
  tenant,
  plans,
  onClose,
  onSaved,
}: {
  tenant: Tenant;
  plans: Plan[];
  onClose: () => void;
  onSaved: (tenant: Tenant, planName: string) => void;
}) {
  const { token } = useAdmin();
  const [planId, setPlanId] = useState(tenant.planId);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function save() {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ tenant: Tenant }>(`/admin/tenants/${tenant.slug}`, { method: "PATCH", token, body: { planId } });
      onSaved(res.tenant, plans.find((p) => p.id === planId)?.name ?? "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setLoading(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={`Plan de ${tenant.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={loading} onClick={save} disabled={planId === tenant.planId}>
            Cambiar plan
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <PlanPicker plans={plans} value={planId} onChange={setPlanId} />
        <Alert type="info">
          El cambio aplica de inmediato y no borra nada. Si el plan nuevo incluye menos, lo que queda fuera deja de
          mostrarse y no se puede crear de nuevo (por ejemplo, usuarios sobre el límite o denuncias de otro marco legal),
          pero se conservan los usuarios, las categorías y las denuncias en curso con sus plazos legales.
        </Alert>
      </div>
    </Modal>
  );
}

function Empty() {
  return <span className="font-normal text-gray-400">—</span>;
}

function AddAdminModal({
  token,
  slug,
  onClose,
  onCreated,
}: {
  token: string;
  slug: string;
  onClose: () => void;
  onCreated: (admin: ClientAdmin, credentials: Credentials) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setLoading(true);
    try {
      const res = await api<{ admin: ClientAdmin; credentials: Credentials }>(`/admin/tenants/${slug}/admins`, {
        method: "POST",
        token,
        body: { name, email },
      });
      onCreated(res.admin, res.credentials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      setLoading(false);
    }
  }

  return (
    <Modal
      title="Agregar administrador"
      description="El usuario tendrá rol client_admin en esta empresa."
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="add-admin" variant="primary" loading={loading}>
            Crear acceso
          </Button>
        </>
      }
    >
      <form id="add-admin" onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre completo" required autoFocus value={name} error={fields.name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Correo electrónico"
          type="email"
          required
          value={email}
          error={fields.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="text-sm text-gray-500">
          Se generará una contraseña temporal. Al ingresar deberá cambiarla y configurar la verificación en dos pasos.
        </p>
      </form>
    </Modal>
  );
}

const PROFILE_KEYS = ["legalName", "taxId", "contactName", "contactEmail", "contactPhone", "notes"] as const;

function EditProfileModal({
  token,
  tenant,
  onClose,
  onSaved,
}: {
  token: string;
  tenant: Tenant;
  onClose: () => void;
  onSaved: (tenant: Tenant) => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [profile, setProfile] = useState<Record<keyof TenantProfile, string>>(
    () => Object.fromEntries(PROFILE_KEYS.map((k) => [k, tenant[k] ?? ""])) as Record<keyof TenantProfile, string>,
  );
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const set = (key: keyof TenantProfile) => (e: { target: { value: string } }) =>
    setProfile((p) => ({ ...p, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setLoading(true);
    try {
      const res = await api<{ tenant: Tenant }>(`/admin/tenants/${tenant.slug}`, {
        method: "PATCH",
        token,
        body: { name, ...profile },
      });
      onSaved(res.tenant);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      setLoading(false);
    }
  }

  return (
    <Modal
      title="Editar ficha de la empresa"
      description="El slug y la base de datos no se pueden modificar."
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="edit-profile" variant="primary" loading={loading}>
            Guardar cambios
          </Button>
        </>
      }
    >
      <form id="edit-profile" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Nombre" required value={name} error={fields.name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Field label="Razón social" value={profile.legalName} error={fields.legalName} onChange={set("legalName")} />
        </div>
        <Field label="RUT" value={profile.taxId} error={fields.taxId} onChange={set("taxId")} />
        <Field label="Persona de contacto" value={profile.contactName} error={fields.contactName} onChange={set("contactName")} />
        <Field
          label="Email de contacto"
          type="email"
          value={profile.contactEmail}
          error={fields.contactEmail}
          onChange={set("contactEmail")}
        />
        <Field
          label="Teléfono"
          type="tel"
          value={profile.contactPhone}
          error={fields.contactPhone}
          onChange={set("contactPhone")}
        />
        <div className="sm:col-span-2">
          <TextArea label="Notas internas" value={profile.notes} onChange={set("notes")} />
        </div>
      </form>
    </Modal>
  );
}
