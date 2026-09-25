import { KeyValue, Panel } from "../../components/ui";
import { useChannel } from "../../lib/channel-context";
import { ROLES, ROLE_ORDER, hasScopedRole } from "../../lib/roles";
import { AccountView } from "../AccountPage";

/** "Mi cuenta" en el panel de una empresa, con el rol y las categorías del usuario. */
export function ChannelAccountPage() {
  const { user, token, logout, updateToken, apiBase, basePath } = useChannel();
  const role = ROLES[user.activeRole];

  return (
    <AccountView
      apiBase={apiBase}
      token={token}
      logout={logout}
      updateToken={updateToken}
      roleLabel={role.label}
      homePath={basePath}
    >
      <Panel title="Tu rol en el canal">
        <dl className="space-y-5">
          <KeyValue label="Rol activo">{role.label}</KeyValue>
          {user.roles.length > 1 && (
            <KeyValue label="Tus roles">
              {ROLE_ORDER.filter((r) => user.roles.includes(r))
                .map((r) => ROLES[r].label)
                .join(", ")}
            </KeyValue>
          )}
          {user.area && <KeyValue label="Área">{user.area}</KeyValue>}
          <KeyValue label="Categorías">
            {!hasScopedRole(user.roles)
              ? "No aplica: no gestionas denuncias"
              : user.categories?.length
                ? user.categories.join(", ")
                : "Sin categorías a cargo"}
          </KeyValue>
        </dl>
        <p className="mt-5 text-sm leading-relaxed text-gray-500">
          Tus roles, tu área y tus categorías los asigna el administrador del canal.
        </p>
      </Panel>
    </AccountView>
  );
}
