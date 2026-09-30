import { MailSettings } from "../components/MailSettings";
import { Breadcrumbs, PageHeader } from "../components/ui";
import { useAdmin } from "../lib/admin-context";

/** Correo saliente por defecto de la plataforma: lo usan la consola y todas las empresas sin SMTP propio. */
export function MailPage() {
  const { token, logout, user } = useAdmin();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Resumen", to: "/admin/overview" },
          { label: "Correo saliente" },
        ]}
      />
      <PageHeader
        title="Correo saliente"
        description="Servidor SMTP por defecto de la plataforma. Lo usan la consola y todas las empresas que no configuren su propio correo (por ejemplo, para recuperar la contraseña)."
      />
      <MailSettings
        endpoint="/admin/mail"
        token={token}
        onUnauthorized={logout}
        scope="platform"
        defaultFromName="Canal de Denuncias"
        defaultTestTo={user.email}
      />
    </>
  );
}
