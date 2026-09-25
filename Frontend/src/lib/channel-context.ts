import type { PublicBranding } from "./branding";
import { useOutletContext } from "react-router";
import type { TenantRole } from "./roles";

/** Empresa del panel, con su marca. */
export interface ChannelTenant {
  name: string;
  slug: string;
  branding?: PublicBranding;
}

export interface ChannelUser {
  id: string;
  name: string;
  email: string;
  /** Todos los roles de la persona. */
  roles: TenantRole[];
  /** Rol con el que está trabajando ahora (define el menú y los permisos). */
  activeRole: TenantRole;
  area: string | null;
  /** null = todas las categorías. */
  categories: string[] | null;
  mustChangePassword: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  passwordChangedAt: string;
}

export interface ChannelContext {
  user: ChannelUser;
  tenant: ChannelTenant;
  token: string;
  logout: () => void;
  updateToken: (token: string) => void;
  /** Prefijo de la API de esta empresa: "/t/{slug}". */
  apiBase: string;
  /** Ruta base del panel en el frontend: "/{slug}". */
  basePath: string;
  refreshUser: () => void;
  /** Cambia el rol activo sin cerrar sesión. */
  switchRole: (role: TenantRole) => Promise<void>;
}

/** Datos de sesión para las páginas del panel de la empresa (los entrega ChannelLayout). */
export const useChannel = () => useOutletContext<ChannelContext>();
