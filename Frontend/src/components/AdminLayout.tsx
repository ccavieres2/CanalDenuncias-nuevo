import { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import type { AdminContext } from "../lib/admin-context";
import { api } from "../lib/api";
import { GLOBAL_SCOPE, clearToken, getToken, setToken } from "../lib/session";
import type { User } from "../lib/types";
import { ConsoleShell, type NavSection } from "./ConsoleShell";
import { FullPageSpinner } from "./ui";

const NAV: NavSection[] = [
  { title: "General", items: [{ to: "/admin/overview", label: "Resumen", icon: "grid" }] },
  { title: "Plataforma", items: [{ to: "/admin/tenants", label: "Empresas", icon: "building" }] },
  {
    title: "Administración",
    items: [
      { to: "/admin/team", label: "Equipo BeeHives", icon: "users" },
      { to: "/admin/audit", label: "Auditoría", icon: "activity" },
      { to: "/admin/system", label: "Estado del sistema", icon: "server" },
    ],
  },
];

/** Consola del equipo BeeHives (global_admin). */
export function AdminLayout() {
  const navigate = useNavigate();
  const [token, setTokenState] = useState(() => getToken(GLOBAL_SCOPE));
  const [user, setUser] = useState<User | null>(null);

  const logout = useCallback(() => {
    clearToken(GLOBAL_SCOPE);
    navigate("/admin/login", { replace: true });
  }, [navigate]);

  /** Reemplaza la sesión (p. ej. tras cambiar la contraseña, que invalida la anterior). */
  const updateToken = useCallback((next: string) => {
    setToken(GLOBAL_SCOPE, next);
    setTokenState(next);
  }, []);

  useEffect(() => {
    if (!token) return logout();
    api<{ user: User }>("/admin/auth/me", { token })
      .then((res) => setUser(res.user))
      .catch(logout);
  }, [token, logout]);

  if (!user || !token) return <FullPageSpinner />;

  return (
    <ConsoleShell
      nav={NAV}
      caption="Consola de administración"
      user={user}
      roleLabel="Equipo BeeHives · global_admin"
      accountPath="/admin/account"
      onLogout={logout}
    >
      <Outlet context={{ user, token, logout, updateToken } satisfies AdminContext} />
    </ConsoleShell>
  );
}
