# --- Desarrollo: Vite con recarga automática (el código se monta como volumen) ---
FROM node:24-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# --- Compilación ---
FROM dev AS build
COPY . .
RUN npm run build

# --- Producción: nginx sin privilegios con la app compilada y las cabeceras de seguridad ---
FROM nginxinc/nginx-unprivileged:alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
