import { useOutletContext } from "react-router";
import type { PublicBranding } from "./branding";
import type { LegalFramework } from "./roles";

/** Datos públicos del canal de una empresa (portal del denunciante). */
export interface PublicPortal {
  company: string;
  portal: {
    title: string;
    welcome: string;
    policy: string;
    allowAnonymous: boolean;
    contactEmail: string | null;
    reportEmail: string | null;
    phone: string | null;
    inPerson: string | null;
  };
  retentionMonths: number;
  relations: string[];
  categories: { id: string; name: string; description: string | null; framework: LegalFramework; asksDetail: boolean }[];
  branding: PublicBranding;
}

export interface PortalContext {
  slug: string;
  /** Prefijo de la API pública de la empresa. */
  apiBase: string;
  /** Ruta base del portal (/:slug/denuncias). */
  basePath: string;
  data: PublicPortal;
}

export const usePortal = () => useOutletContext<PortalContext>();

/** Seguimiento que ve el denunciante con su clave. */
export interface ReporterView {
  code: string;
  subject: string;
  category: string;
  status: "received" | "in_review" | "investigating" | "closed";
  statusLabel: string;
  statusDescription: string;
  receivedAt: string;
  acknowledgedAt: string | null;
  closedAt: string | null;
  isAnonymous: boolean;
  canReply: boolean;
  authenticatorEnabled: boolean;
  /** Sesión de 30 minutos para seguir operando sin volver a ingresar. */
  session: string;
  messages: { id: string; sender: "reporter" | "staff"; body: string; createdAt: string; readAt: string | null }[];
}

export const PUBLIC_STEPS: { key: ReporterView["status"]; label: string }[] = [
  { key: "received", label: "Recibida" },
  { key: "in_review", label: "En revisión" },
  { key: "investigating", label: "En investigación" },
  { key: "closed", label: "Cerrada" },
];
