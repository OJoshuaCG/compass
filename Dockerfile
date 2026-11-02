# Imagen única: la API sirve también la web compilada (WEB_DIST_DIR). Los comandos de operaciones
# (migraciones, alta de organización, recifrado) corren con esta misma imagen y otro comando.
# Guía de despliegue: docs/deployment.md §2.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# CI evita preguntas interactivas de pnpm durante la construcción.
ENV CI=true
# La versión de pnpm sale de "packageManager" en package.json.
COPY package.json ./
RUN corepack enable && corepack install
# Las dependencias se descargan solo con el lockfile: mientras no cambie, esta capa queda en caché y
# un despliegue que solo cambió código no vuelve a bajar nada del registro.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --offline --frozen-lockfile
# Solo lo que se despliega: la API con sus paquetes del workspace y la web.
RUN pnpm --filter "@iam/api..." --filter @iam/web build
# Copia la API con sus dependencias de producción y los paquetes del workspace según su campo
# "files" (@iam/db lleva sus migraciones). Sin herramientas de desarrollo, pruebas ni código fuente.
# inject-workspace-packages solo en este comando: así deploy reutiliza el lockfile (mismas versiones,
# sin red) sin cambiar cómo se instala el workspace.
RUN pnpm --config.inject-workspace-packages=true --filter @iam/api deploy --prod --offline /deploy/api

FROM node:24-bookworm-slim
WORKDIR /app
# HOST debe ser 0.0.0.0: con el valor por defecto (127.0.0.1) el proxy del despliegue no llega a la API.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist
# Las mismas rutas que en el repositorio, para que los comandos de operaciones no cambien
# (node apps/api/dist/main.<comando>.js). Los archivos son de root y de solo lectura para la API.
COPY --from=build /deploy/api /app/apps/api
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY docker/start.sh /app/start.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Antes de atender, alinea los roles de sistema con las plantillas de esta versión, con reintentos;
# si sigue fallando (base caída, migraciones sin aplicar), la API no arranca. Detalle en el script.
CMD ["sh", "/app/start.sh"]
