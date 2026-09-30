import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { devHeaders, prodHeaders } from "./security-headers.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: devHeaders,
    // En Docker sobre Windows los cambios de archivos no llegan como eventos; se usa polling.
    watch: process.env.VITE_USE_POLLING === "true" ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      // xfwd: envía X-Forwarded-For para que el backend registre la IP real del usuario.
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000", xfwd: true },
    },
  },
  // Vista previa del build (npm run preview): mismas cabeceras estrictas que producción.
  preview: { headers: prodHeaders },
});
