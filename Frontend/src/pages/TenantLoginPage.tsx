import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Brand } from "../components/Brand";
import { LoginCard } from "../components/LoginCard";
import { FullPageSpinner, Icon } from "../components/ui";
import { api } from "../lib/api";
import { type PublicBranding, brandStyle } from "../lib/branding";
import { getToken, setToken, tenantScope } from "../lib/session";

export function TenantLoginPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [branding, setBranding] = useState<PublicBranding | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api<{ tenant: { name: string; branding: PublicBranding } }>(`/t/${slug}`)
      .then((res) => {
        setTenantName(res.tenant.name);
        setBranding(res.tenant.branding);
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  if (getToken(tenantScope(slug))) return <Navigate to={`/${slug}`} replace />;
  if (notFound) return <TenantNotFound />;
  if (!tenantName) return <FullPageSpinner />;

  return (
    <LoginCard
      caption={tenantName}
      headline={
        <>
          Canal de denuncias de <span className="text-white/60">{tenantName}</span>
        </>
      }
      tagline="Espacio de gestión para las personas designadas para administrar y gestionar el canal."
      description={`Ingresa con tu cuenta de ${tenantName}.`}
      footer={
        <p className="mt-6 text-center text-sm text-gray-500">
          ¿Quieres hacer una denuncia o seguir una?{" "}
          <Link to={`/${slug}/denuncias`} className="inline-flex items-center gap-1 font-semibold text-highlight-text hover:underline">
            Ir al canal de denuncias
            <Icon name="chevron" className="size-3" />
          </Link>
        </p>
      }
      apiBase={`/t/${slug}`}
      orgLogoUrl={branding?.logoUrl}
      style={brandStyle(branding?.primaryColor)}
      onAuthenticated={(token) => {
        setToken(tenantScope(slug), token);
        navigate(`/${slug}`, { replace: true });
      }}
    />
  );
}

export function TenantNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="px-6 pt-8 sm:px-10">
        <Brand tone="light" />
      </div>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-md text-center">
          <p className="text-sm font-semibold text-accent">Error 404</p>
          <h1 className="mt-3 text-[30px] font-semibold tracking-tight text-gray-900">Organización no encontrada</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-500">
            La dirección no corresponde a ninguna organización activa. Verifica la URL o contacta a tu administrador.
          </p>
        </div>
      </main>
    </div>
  );
}
