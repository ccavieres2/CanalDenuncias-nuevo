import { type FormEvent, useEffect, useState } from "react";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { RecoveryCodesStep } from "../components/MfaSteps";
import { Alert, Avatar, Badge, Breadcrumbs, Button, Icon, KeyValue, Modal, PageHeader, Panel } from "../components/ui";
import { useAdmin } from "../lib/admin-context";
import { ApiError, api } from "../lib/api";
import type { User } from "../lib/types";
import { formatDate, initials } from "../lib/ui-helpers";

/** "Mi cuenta" de la consola BeeHives. */
export function AccountPage() {
  const { token, logout, updateToken } = useAdmin();
  return (
    <AccountView
      apiBase="/admin"
      token={token}
      logout={logout}
      updateToken={updateToken}
      roleLabel="global_admin"
      homePath="/admin"
    />
  );
}

/** Datos de acceso y seguridad de la cuenta. Se usa en la consola BeeHives y en el panel de cada empresa. */
export function AccountView({
  apiBase,
  token,
  logout,
  updateToken,
  roleLabel,
  homePath,
  children,
}: {
  apiBase: string;
  token: string;
  logout: () => void;
  updateToken: (token: string) => void;
  roleLabel: string;
  homePath: string;
  /** Información adicional bajo la tarjeta de perfil (p. ej. rol y categorías). */
  children?: React.ReactNode;
}) {
  const [me, setMe] = useState<User | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [passwordFormKey, setPasswordFormKey] = useState(0);

  useEffect(() => {
    api<{ user: User }>(`${apiBase}/auth/me`, { token })
      .then((res) => setMe(res.user))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) logout();
      });
  }, [apiBase, token, logout, reloadKey]);

  const remaining = me?.recoveryCodesRemaining ?? 0;

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio", to: homePath }, { label: "Mi cuenta" }]} />
      <PageHeader title="Mi cuenta" description="Tus datos de acceso y la seguridad de tu cuenta." />

      {flash && (
        <div className="mb-6">
          <Alert type="success">{flash}</Alert>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel>
            {me ? (
              <div className="flex items-center gap-4">
                <Avatar label={initials(me.name)} className="size-14 text-lg" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-gray-900">{me.name}</p>
                  <p className="truncate text-sm text-gray-500">{me.email}</p>
                  <span className="mt-2 inline-block rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                    {roleLabel}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Cargando…</p>
            )}
          </Panel>

          {children}

          <Panel title="Verificación en dos pasos">
            {me && (
              <div className="space-y-5">
                <dl className="grid grid-cols-2 gap-5">
                  <KeyValue label="Estado">
                    <Badge
                      styles="bg-emerald-50 text-emerald-700 ring-emerald-600/15"
                      dot="bg-emerald-500"
                      label="Activa"
                    />
                  </KeyValue>
                  <KeyValue label="Configurada el">{formatDate(me.mfaEnabledAt ?? null)}</KeyValue>
                  <KeyValue label="Códigos de recuperación" className="col-span-2">
                    <span className={remaining <= 2 ? "text-amber-700" : ""}>
                      {remaining} de 8 disponibles
                    </span>
                  </KeyValue>
                </dl>
                {remaining <= 2 && (
                  <Alert type="info">Te quedan pocos códigos de recuperación. Genera un juego nuevo.</Alert>
                )}
                <Button onClick={() => setRegenerating(true)} className="w-full">
                  <Icon name="key" />
                  Generar nuevos códigos
                </Button>
              </div>
            )}
          </Panel>
        </div>

        <Panel
          title="Cambiar contraseña"
          description={me?.passwordChangedAt ? `Último cambio: ${formatDate(me.passwordChangedAt, true)}` : undefined}
        >
          <div className="max-w-xl">
            <ChangePasswordForm
              key={passwordFormKey}
              apiBase={apiBase}
              token={token}
              onChanged={(newToken) => {
                updateToken(newToken);
                setPasswordFormKey((k) => k + 1);
                setFlash("Tu contraseña se actualizó. Las demás sesiones abiertas se cerraron.");
                setReloadKey((k) => k + 1);
              }}
            />
          </div>
        </Panel>
      </div>

      {regenerating && me && (
        <RegenerateCodesModal
          apiBase={apiBase}
          token={token}
          email={me.email}
          onClose={() => {
            setRegenerating(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}

function RegenerateCodesModal({
  apiBase,
  token,
  email,
  onClose,
}: {
  apiBase: string;
  token: string;
  email: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ recoveryCodes: string[] }>(`${apiBase}/auth/recovery-codes`, {
        method: "POST",
        token,
        body: { code },
      });
      setCodes(res.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setCode("");
      setLoading(false);
    }
  }

  return (
    <Modal
      title={codes ? "Tus nuevos códigos de recuperación" : "Generar nuevos códigos"}
      description={codes ? undefined : "Los códigos anteriores dejarán de funcionar."}
      onClose={onClose}
    >
      {codes ? (
        <RecoveryCodesStep codes={codes} account={email} onContinue={onClose} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <label className="block">
            <span className="block text-sm font-medium text-gray-800">Código de tu app de autenticación</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              className="mt-2 block h-12 w-full rounded-lg border border-gray-300 bg-white text-center font-mono text-xl tracking-[0.4em] text-gray-900 shadow-sm outline-none transition placeholder:text-gray-300 focus:border-highlight focus:ring-4 focus:ring-highlight/20"
            />
          </label>
          <Button type="submit" variant="primary" loading={loading} disabled={code.length !== 6} className="w-full">
            Generar códigos
          </Button>
        </form>
      )}
    </Modal>
  );
}
