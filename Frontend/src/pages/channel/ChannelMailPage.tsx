import { MailSettings } from "../../components/MailSettings";
import { Breadcrumbs, PageHeader } from "../../components/ui";
import { useChannel } from "../../lib/channel-context";

/** SMTP propio de la empresa (opcional): los correos de su canal salen desde su dominio. */
export function ChannelMailPage() {
  const { token, apiBase, basePath, logout, tenant, user } = useChannel();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Inicio", to: basePath },
          { label: "Correo saliente" },
        ]}
      />
      <PageHeader
        title="Correo saliente"
        description="Configura el servidor de correo (SMTP) de tu empresa para que los correos del canal, como la recuperación de contraseña, salgan desde tu propio dominio. Es opcional: si no lo configuras, se usa el correo de la plataforma."
      />
      <MailSettings
        endpoint={`${apiBase}/console/mail`}
        token={token}
        onUnauthorized={logout}
        scope="tenant"
        defaultFromName={`Canal de Denuncias ${tenant.name}`}
        defaultTestTo={user.email}
      />
    </>
  );
}
