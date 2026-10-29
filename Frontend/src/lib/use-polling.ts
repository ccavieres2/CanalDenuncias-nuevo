import { useEffect, useRef } from "react";

/**
 * Ejecuta `fn` cada `ms` milisegundos mientras la pestaña está visible, y de inmediato al volver a ella. Con la
 * pestaña oculta no consulta: no gasta datos ni carga el servidor. `enabled = false` lo detiene.
 */
export function usePolling(fn: () => unknown, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        await fnRef.current();
      } catch {
        // Un fallo puntual (red, sesión) no detiene el ciclo; la pantalla maneja sus propios errores al actuar.
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(tick, ms);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}
