import { type FormEvent, useEffect, useState } from "react";
import { ConfirmModal, CredentialsModal, RowMenu } from "../components/dialogs";
import { AccountBadges } from "../components/AccountBadges";
import { Alert, Avatar, Breadcrumbs, Button, Field, Icon, Modal, PageHeader, Panel, td, th } from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import type { Credentials, TeamMember } from "../lib/types";
import { formatDate, initials } from "../lib/ui-helpers";

type Pending =
  | { kind: "toggle"; member: TeamMember }
  | { kind: "reset-password"; member: TeamMember }
  | { kind: "reset-mfa"; member: TeamMember };

export function TeamPage() {
  const { token, logout, user } = useAdmin();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [issued, setIssued] = useState<{ title: string; credentials: Credentials } | null>(null);

  useEffect(() => {
    api<{ members: TeamMember[] }>("/admin/team", { token })
      .then((res) => setMembers(res.members))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return logout();
        setError(err instanceof ApiError ? err.message : "Error inesperado");
      });
  }, [token, logout, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const actionsFor = (m: TeamMember) =>
    m.id === user.id
      ? []
      : [
          { label: "Restablecer contraseña", onSelect: () => setPending({ kind: "reset-password", member: m }) },
          {
            label: "Restablecer verificación en dos pasos",
            onSelect: () => setPending({ kind: "reset-mfa", member: m }),
            hidden: !m.mfa_enabled,
          },
          {
            label: m.is_active ? "Desactivar acceso" : "Reactivar acceso",
            onSelect: () => setPending({ kind: "toggle", member: m }),
            danger: m.is_active,
          },
        ];

  return (
    <>
      <Breadcrumbs items={[{ label: "Consola", to: "/admin" }, { label: "Equipo BeeHives" }]} />
      <PageHeader
        title="Equipo BeeHives"
        description="Personas de BeeHives con acceso a esta consola. Cada acceso es personal: no compartan cuentas, así la auditoría identifica quién hizo cada cambio."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} className="w-full sm:w-auto">
            <Icon name="plus" />
            Agregar miembro
          </Button>
        }
      />

      {(flash || error) && (
        <div className="mb-6 space-y-3">
          {flash && <Alert type="success">{flash}</Alert>}
          {error && <Alert>{error}</Alert>}
        </div>
      )}

      <Panel flush title="Miembros" counter={members?.length}>
        {members === null ? (
          <p className="px-6 py-16 text-center text-sm text-gray-500">Cargando…</p>
        ) : (
          <>
            <div className="relative hidden overflow-x-auto md:block">
              <table className="min-w-full">
                <thead className="border-b border-line-soft bg-gray-50/70">
                  <tr>
                    <th className={th}>Miembro</th>
                    <th className={th}>Estado</th>
                    <th className={th}>Último acceso</th>
                    <th className={`${th} hidden xl:table-cell`}>Agregado</th>
                    <th className={th}>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {members.map((m) => (
                    <tr key={m.id} className="transition hover:bg-gray-50/70">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <Avatar label={initials(m.name)} className="size-9 text-xs" />
                          <div>
                            <p className="font-medium text-gray-900">
                              {m.name}
                              {m.id === user.id && <span className="ml-2 text-xs font-normal text-gray-500">(tú)</span>}
                            </p>
                            <p className="text-gray-500">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        <AccountBadges account={m} />
                      </td>
                      <td className={`${td} text-gray-500`}>{formatDate(m.last_login_at, true)}</td>
                      <td className={`${td} hidden text-gray-500 xl:table-cell`}>{formatDate(m.created_at)}</td>
                      <td className={`${td} w-px text-right`}>
                        <RowMenu actions={actionsFor(m)} label={`Acciones para ${m.name}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line-soft md:hidden">
              {members.map((m) => (
                <li key={m.id} className="flex items-start gap-3 px-4 py-4">
                  <Avatar label={initials(m.name)} className="size-10 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">
                      {m.name}
                      {m.id === user.id && <span className="ml-1.5 text-xs font-normal text-gray-500">(tú)</span>}
                    </p>
                    <p className="truncate text-sm text-gray-500">{m.email}</p>
                    <div className="mt-2.5">
                      <AccountBadges account={m} />
                    </div>
                    <p className="mt-2 text-xs text-gray-400">Último acceso: {formatDate(m.last_login_at, true)}</p>
                  </div>
                  <RowMenu actions={actionsFor(m)} label={`Acciones para ${m.name}`} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {adding && (
        <AddMemberModal
          token={token}
          onClose={() => setAdding(false)}
          onCreated={(member, credentials) => {
            setAdding(false);
            setIssued({ title: `Acceso creado para ${member.name}`, credentials });
            reload();
          }}
        />
      )}

      {issued && <CredentialsModal {...issued} loginUrl="/admin/login" onClose={() => setIssued(null)} />}

      {pending?.kind === "toggle" && (
        <ConfirmModal
          title={pending.member.is_active ? `¿Desactivar a ${pending.member.name}?` : `¿Reactivar a ${pending.member.name}?`}
          confirmLabel={pending.member.is_active ? "Desactivar" : "Reactivar"}
          danger={pending.member.is_active}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api(`/admin/team/${pending.member.id}`, {
              method: "PATCH",
              token,
              body: { isActive: !pending.member.is_active },
            });
            setFlash(
              pending.member.is_active
                ? `${pending.member.name} ya no tiene acceso a la consola.`
                : `${pending.member.name} vuelve a tener acceso a la consola.`,
            );
            setPending(null);
            reload();
          }}
        >
          {pending.member.is_active ? (
            <p>Perderá el acceso de inmediato, incluso si tiene una sesión abierta. Su historial en la auditoría se conserva.</p>
          ) : (
            <p>Podrá volver a iniciar sesión con su contraseña y su verificación en dos pasos actuales.</p>
          )}
        </ConfirmModal>
      )}

      {pending?.kind === "reset-password" && (
        <ConfirmModal
          title="Restablecer contraseña"
          confirmLabel="Generar contraseña temporal"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const res = await api<{ credentials: Credentials }>(`/admin/team/${pending.member.id}/reset-password`, {
              method: "POST",
              token,
            });
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
            await api(`/admin/team/${pending.member.id}/reset-mfa`, { method: "POST", token });
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

function AddMemberModal({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: (member: TeamMember, credentials: Credentials) => void;
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
      const res = await api<{ member: TeamMember; credentials: Credentials }>("/admin/team", {
        method: "POST",
        token,
        body: { name, email },
      });
      onCreated(res.member, res.credentials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setFields(err instanceof ApiError ? (err.fields ?? {}) : {});
      setLoading(false);
    }
  }

  return (
    <Modal
      title="Agregar miembro del equipo"
      description="Tendrá acceso completo a la consola de administración."
      onClose={onClose}
      footer={
        <>
          <Button variant="link" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="add-member" variant="primary" loading={loading}>
            Crear acceso
          </Button>
        </>
      }
    >
      <form id="add-member" onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre completo" required autoFocus value={name} error={fields.name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Correo electrónico"
          type="email"
          required
          placeholder="nombre@bee-hives.com"
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
