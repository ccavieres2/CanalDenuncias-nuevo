import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router";
import { initials } from "../lib/ui-helpers";
import { Brand, BrandLogo, BrandMark } from "./Brand";
import { Avatar, Icon } from "./ui";

type IconName = Parameters<typeof Icon>[0]["name"];

export interface NavSection {
  title: string;
  /** hidden: el ítem no se muestra (por ejemplo, un módulo que el plan de la empresa no incluye). */
  items: { to: string; label: string; icon: IconName; end?: boolean; hidden?: boolean }[];
}

/** Roles entre los que la persona puede cambiar (solo si tiene más de uno). */
export interface RoleSwitch {
  options: { value: string; label: string }[];
  active: string;
  onSwitch: (value: string) => Promise<void>;
}

interface ShellProps {
  nav: NavSection[];
  /** Texto bajo la marca: "Consola de administración" o el nombre de la empresa. */
  caption: string;
  user: { name: string; email: string };
  /** Rol visible en el menú de usuario. */
  roleLabel: string;
  accountPath: string;
  onLogout: () => void;
  roleSwitch?: RoleSwitch;
  /** Logo de la empresa (panel de cada empresa). */
  orgLogoUrl?: string | null;
  /** Variables de color de la marca de la empresa. */
  style?: CSSProperties;
  /** Panel de una empresa: al pie del menú va «Powered by BeeHives» en vez de la cuenta del usuario. */
  poweredBy?: boolean;
  /** Acciones junto al menú de usuario (p. ej., la campana de alertas). */
  headerActions?: ReactNode;
  children: ReactNode;
}

/**
 * Estructura común de las consolas (BeeHives y cada empresa): navegación lateral
 * fija en escritorio, deslizable en móvil, y barra superior con el menú de usuario.
 */
export function ConsoleShell({
  nav,
  caption,
  user,
  roleLabel,
  accountPath,
  onLogout,
  roleSwitch,
  orgLogoUrl,
  style,
  poweredBy,
  headerActions,
  children,
}: ShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Menú móvil: se cierra con Escape y bloquea el scroll de fondo mientras está abierto.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const sidebar = (onNavigate?: () => void) => (
    <Sidebar
      nav={nav}
      caption={caption}
      user={user}
      accountPath={accountPath}
      onLogout={onLogout}
      onNavigate={onNavigate}
      orgLogoUrl={orgLogoUrl}
      poweredBy={poweredBy}
    />
  );

  return (
    <div className="min-h-screen bg-canvas" style={style}>
      {/* Navegación lateral fija (escritorio) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{sidebar()}</aside>

      {/* Navegación deslizable (móvil y tablet) */}
      <div className={`fixed inset-0 z-50 lg:hidden ${menuOpen ? "" : "pointer-events-none"}`} aria-hidden={!menuOpen}>
        <div
          onClick={() => setMenuOpen(false)}
          className={`absolute inset-0 bg-brand-ink/60 backdrop-blur-[2px] transition-opacity duration-200 ${
            menuOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          role="dialog"
          aria-modal
          aria-label="Menú"
          className={`absolute inset-y-0 left-0 w-[min(18rem,85vw)] shadow-pop transition-transform duration-200 ease-out ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {sidebar(() => setMenuOpen(false))}
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menú"
            className="absolute top-4 right-3 rounded-md p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div className="lg:pl-64">
        {/* Barra superior */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-white/85 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menú"
              className="-ml-1 rounded-lg p-2 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
            >
              <Icon name="menu" className="size-5" />
            </button>
            {orgLogoUrl ? (
              <img src={orgLogoUrl} alt={caption} className="h-8 w-auto max-w-[120px] shrink-0 object-contain" />
            ) : (
              <BrandMark className="h-8 w-auto shrink-0" />
            )}
            <span className="truncate text-[15px] font-semibold text-gray-900">{caption}</span>
          </div>
          {import.meta.env.DEV ? (
            <span className="hidden items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-600/15 ring-inset lg:inline-flex">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Entorno de desarrollo
            </span>
          ) : (
            <span className="hidden lg:block" />
          )}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {headerActions}
            <UserMenu user={user} roleLabel={roleLabel} accountPath={accountPath} onLogout={onLogout} roleSwitch={roleSwitch} />
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
          <div className="mx-auto max-w-[1800px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  nav,
  caption,
  user,
  accountPath,
  onLogout,
  onNavigate,
  orgLogoUrl,
  poweredBy,
}: Omit<ShellProps, "roleLabel" | "children" | "roleSwitch" | "style"> & {
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-nav">
      {/* En el menú móvil se deja espacio a la derecha para el botón de cerrar. */}
      <div className="border-b border-nav-line px-6 pt-7 pb-6 max-lg:pr-14">
        {/* Logo de la empresa si lo configuró; si no, el de BeeHives. */}
        <Brand stacked caption={caption} logoUrl={orgLogoUrl} />
      </div>

      <nav className="scrollbar-nav flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {nav.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.08em] text-white/35 uppercase">{section.title}</p>
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold tracking-tight text-white transition ${
                      isActive ? "bg-white/[0.12]" : "hover:bg-nav-hover"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-2 -left-3 w-1 rounded-r-full bg-nav-accent" />}
                      <Icon name={item.icon} className={`size-[18px] ${isActive ? "text-nav-accent" : ""}`} />
                      {item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {poweredBy ? (
        <div className="flex items-center gap-2.5 border-t border-nav-line px-6 py-4">
          <span className="text-xs font-semibold tracking-tight text-white">Powered by</span>
          <BrandLogo tone="dark" className="h-[18px]" />
        </div>
      ) : (
        <div className="border-t border-nav-line p-3">
          <div className="flex items-center gap-1">
            <Link
              to={accountPath}
              onClick={onNavigate}
              title="Mi cuenta"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.06]"
            >
              <Avatar label={initials(user.name)} className="size-9 bg-white/10 text-sm text-white" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{user.name}</p>
                <p className="truncate text-xs text-white/50">{user.email}</p>
              </div>
            </Link>
            <button
              onClick={onLogout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="rounded-md p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu({
  user,
  roleLabel,
  accountPath,
  onLogout,
  roleSwitch,
}: Pick<ShellProps, "user" | "roleLabel" | "accountPath" | "onLogout" | "roleSwitch">) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const canSwitch = roleSwitch && roleSwitch.options.length > 1;

  async function switchTo(value: string) {
    if (!roleSwitch || value === roleSwitch.active) return setOpen(false);
    setSwitching(value);
    try {
      await roleSwitch.onSwitch(value);
      setOpen(false);
    } finally {
      setSwitching(null);
    }
  }
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Menú de usuario"
        className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 transition hover:bg-gray-100 sm:pr-2"
      >
        <Avatar label={initials(user.name)} className="size-8 text-xs" />
        <span className="hidden text-sm font-medium text-gray-700 sm:inline">{user.name}</span>
        <Icon
          name="chevron"
          className={`hidden size-3.5 text-gray-400 transition-transform sm:block ${open ? "-rotate-90" : "rotate-90"}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-white shadow-pop">
          <div className="flex items-center gap-3 px-4 py-4">
            <Avatar label={initials(user.name)} className="size-10 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{user.name}</p>
              <p className="truncate text-sm text-gray-500">{user.email}</p>
            </div>
          </div>
          {canSwitch ? (
            <div className="border-t border-line-soft py-2">
              <p className="px-4 pt-1 pb-2 text-[11px] font-semibold tracking-[0.08em] text-gray-400 uppercase">Cambiar de rol</p>
              {roleSwitch.options.map((o) => {
                const active = o.value === roleSwitch.active;
                return (
                  <button
                    key={o.value}
                    onClick={() => switchTo(o.value)}
                    disabled={switching !== null}
                    className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition disabled:opacity-60 ${
                      active ? "font-medium text-accent" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {switching === o.value ? (
                        <span className="size-3.5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
                      ) : (
                        active && <Icon name="check" className="size-4 text-highlight-text" />
                      )}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="border-t border-line-soft px-4 py-3">
              <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent">{roleLabel}</span>
            </div>
          )}
          <Link
            to={accountPath}
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 border-t border-line-soft px-4 py-3 text-left text-sm text-gray-700 transition hover:bg-gray-50"
          >
            <Icon name="settings" className="size-4 text-gray-400" />
            Mi cuenta
          </Link>
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 border-t border-line-soft px-4 py-3 text-left text-sm text-gray-700 transition hover:bg-gray-50"
          >
            <Icon name="logout" className="size-4 text-gray-400" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
