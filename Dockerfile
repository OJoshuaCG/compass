# Imagen única: la API sirve también la web compilada (WEB_DIST_DIR). Los comandos de operaciones
# (migraciones, alta de organización, recifrado) corren con esta misma imagen y otro comando.
# Esta imagen aún no se ha construido ni probado (ver docs/deployment.md).

FROM node:24-bookworm-slim AS build
WORKDIR /app
# La versión de pnpm sale de "packageManager" en package.json.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
# HOST debe ser 0.0.0.0: con el valor por defecto (127.0.0.1) el proxy del despliegue no llega a la API.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/api/dist/main.http.js"]
