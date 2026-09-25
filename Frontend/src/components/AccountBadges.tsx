import type { ManagedAccount } from "../lib/types";
import { Badge } from "./ui";

const TONES = {
  success: { styles: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", dot: "bg-emerald-500" },
  warning: { styles: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  neutral: { styles: "bg-gray-100 text-gray-700 ring-gray-500/15", dot: "bg-gray-400" },
};

/** Estado de una cuenta: activa, 2FA y si tiene una contraseña temporal pendiente. */
export function AccountBadges({ account }: { account: ManagedAccount }) {
  if (!account.is_active) return <Badge {...TONES.neutral} label="Desactivado" />;
  return (
    <div className="flex flex-wrap gap-2">
      <Badge {...TONES.success} label="Activo" />
      {account.mfa_enabled ? (
        <Badge {...TONES.success} label="2FA configurada" />
      ) : (
        <Badge {...TONES.warning} label="2FA pendiente" />
      )}
      {account.must_change_password && <Badge {...TONES.warning} label="Contraseña temporal" />}
    </div>
  );
}
