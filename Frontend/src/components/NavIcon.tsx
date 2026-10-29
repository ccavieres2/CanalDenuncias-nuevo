import { Icon } from "./ui";

type IconName = Parameters<typeof Icon>[0]["name"];

/**
 * Íconos del menú lateral (diseño BeeHives: retícula 24 × 24, trazo 1,7, extremos redondeados). Se dibujan con
 * currentColor: el menú les da el color (blanco en reposo, el acento de la marca en la sección activa), así se
 * adaptan a la marca de cada empresa sin variantes por color.
 */
const NAV_ICONS = {
  navHome: (
    <>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.3" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1.3" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1.3" />
      <rect x="14.5" y="14.5" width="6" height="6" rx="1.3" />
    </>
  ),
  navUsers: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4.5a3 3 0 0 1 0 5.8M18 13.4a5 5 0 0 1 3 4.6v2" />
    </>
  ),
  navAreas: <path d="M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M15 10h4a1 1 0 0 1 1 1v10M2 21h20M8 21v-4h3v4M8 7h3M8 11h3M18 14h2M18 17h2" />,
  navCategories: (
    <>
      <path d="M3.5 5a1.5 1.5 0 0 1 1.5-1.5h6l9.5 9.5a1.5 1.5 0 0 1 0 2.1l-5.4 5.4a1.5 1.5 0 0 1-2.1 0L3.5 11Z" />
      <circle cx="8" cy="8" r="1.25" />
    </>
  ),
  navPortal: <path d="M11 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M14 3h7v7M21 3 11 13" />,
  navBrand: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1a2.5 2.5 0 0 0 1.9-4.1 1.5 1.5 0 0 1 1.1-2.4h2a3 3 0 0 0 3-3A8.5 8.5 0 0 0 12 3Z" />
      <circle cx="7" cy="11" r=".8" />
      <circle cx="10" cy="7" r=".8" />
      <circle cx="15" cy="7.5" r=".8" />
    </>
  ),
  navMail: <path d="M20.5 10V6a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 6v12A1.5 1.5 0 0 0 5 19.5h7M4 6l8 6 8-6M15 16.5h7M19 13.5l3 3-3 3" />,
  navRules: <path d="M11 6h10M11 12h10M11 18h10M3 5.5l1.5 1.5L7 4.5M3 11.5l1.5 1.5L7 10.5M3 17.5l1.5 1.5L7 16.5" />,
  navFlows: (
    <>
      <rect x="8.5" y="2.5" width="7" height="5" rx="1.2" />
      <rect x="2.5" y="16.5" width="7" height="5" rx="1.2" />
      <rect x="14.5" y="16.5" width="7" height="5" rx="1.2" />
      <path d="M12 7.5v5M6 16.5v-4h12v4" />
    </>
  ),
  navAudit: (
    <>
      <path d="M11 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4M8 7h4M8 11h2M8 15h2" />
      <circle cx="16" cy="15" r="4" />
      <path d="m19 18 3 3" />
    </>
  ),
  navCaseFlow: (
    <>
      <path d="M3 3h9v7H7l-4 3ZM7 15v3a1 1 0 0 0 1 1h4M10 17l2 2-2 2" />
      <circle cx="18" cy="18" r="4" />
      <path d="m16.5 18 1 1 2-2" />
    </>
  ),
};

export type NavIconName = keyof typeof NAV_ICONS;

/** Ícono de un ítem del menú: el del diseño BeeHives si existe; si no, el ícono general equivalente. */
export function MenuIcon({ name, className = "size-5" }: { name: NavIconName | IconName; className?: string }) {
  if (!(name in NAV_ICONS)) return <Icon name={name as IconName} className={className} />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {NAV_ICONS[name as NavIconName]}
    </svg>
  );
}
