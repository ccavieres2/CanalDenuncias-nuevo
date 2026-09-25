FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# --- Desarrollo: el código se monta como volumen y se recarga solo ---
FROM base AS dev
RUN npm ci
EXPOSE 4000
CMD ["npm", "run", "dev"]

# --- Producción: JS compilado, sin devDependencies ---
FROM base AS build
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 4000
CMD ["node", "dist/index.js"]
