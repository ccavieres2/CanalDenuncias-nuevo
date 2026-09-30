// Cabeceras de seguridad de la aplicación web. Las usa Vite (desarrollo y vista previa); nginx.conf repite las de
// producción. Sin recursos de terceros: todo (scripts, estilos, fuentes, imágenes) se sirve desde este mismo sitio.

const common = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const csp = (dev: boolean) =>
  [
    "default-src 'self'",
    // Desarrollo: Vite y React Refresh inyectan scripts en línea. Producción: solo archivos del sitio.
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    // Estilos en línea: Vite los inyecta en desarrollo y React usa atributos style (colores de la marca).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

export const devHeaders = { ...common, "Content-Security-Policy": csp(true) };
export const prodHeaders = { ...common, "Content-Security-Policy": csp(false) };
