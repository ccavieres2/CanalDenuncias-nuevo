import { Navigate, useNavigate } from "react-router";
import { LoginCard } from "../components/LoginCard";
import { GLOBAL_SCOPE, getToken, setToken } from "../lib/session";

export function AdminLoginPage() {
  const navigate = useNavigate();
  if (getToken(GLOBAL_SCOPE)) return <Navigate to="/admin" replace />;

  return (
    <LoginCard
      caption="Consola de administración"
      headline="Administración central de la plataforma"
      tagline="Gestiona las organizaciones cliente, sus accesos y la configuración de cada canal desde un único lugar."
      description="Ingresa con tu cuenta de administrador de la plataforma."
      apiBase="/admin"
      onAuthenticated={(token) => {
        setToken(GLOBAL_SCOPE, token);
        navigate("/admin", { replace: true });
      }}
    />
  );
}
