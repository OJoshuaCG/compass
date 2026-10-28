# Ejecución local y despliegue en Dokploy

Esta guía dice cómo correr la plataforma en tu equipo y cómo desplegarla con Dokploy. El despliegue es el **objetivo acordado** (Dokploy con Docker, PostgreSQL en un servidor dedicado, AWS KMS para las claves); **todavía no se ha ensayado de punta a punta**. Cada paso marca qué se verificó y qué no.

Referencias: [`README.md`](../README.md); [`docs/database.md`](database.md) §1 y §3; [ADR 0020](adr/0020-reference-cloud-aws.md); [ADR 0039](adr/0039-single-instance-until-redis.md); [runbooks](runbooks/README.md).

## 1. Correrlo en local

Requisitos: los de la tabla del [`README.md`](../README.md) (Node 24, pnpm 10, Podman o Docker, Chrome).

1. Instala dependencias: `pnpm install`.
2. Con Podman, activa el servicio de usuario y exporta las variables (una vez por terminal):

   ```bash
   systemctl --user enable --now podman.socket
   export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
   export TESTCONTAINERS_RYUK_DISABLED=true
   ```

3. Levanta la plataforma completa: `pnpm stack`. Compila API y web, arranca una base de datos temporal, crea una organización de ejemplo y muestra: la dirección de la app (`http://localhost:3100`), el correo y la contraseña de la Raíz, y el buzón de pruebas donde llega el último correo (`http://127.0.0.1:3101/last`). Los datos se borran con Ctrl+C.
4. Solo interfaz con recarga en vivo: `pnpm --filter @iam/web dev`.
5. Verificación completa antes de un cambio: `pnpm format:check`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (y `pnpm e2e` si cambió la interfaz o la API).

Notas:

- Usa `localhost`, no una IP: las llaves de acceso (WebAuthn) exigen un dominio.
- Fuera de `pnpm stack` no hay un modo "API local contra una base persistente" documentado. Si lo necesitas, hay que agregarlo.
- En local el adaptador de claves es `local` (archivo `.local-kms/kek.key`, ignorado por git). No sirve en producción: la API se niega a arrancar así.

## 2. Despliegue en Dokploy

### 2.1 Qué se despliega

| Pieza | Dónde | Estado |
| --- | --- | --- |
| API + web (una imagen, un contenedor) | Dokploy, construida con el `Dockerfile` de la raíz | `Dockerfile` escrito, **sin construir ni probar** |
| PostgreSQL | Servidor dedicado, fuera de Dokploy | Por provisionar |
| Claves (KEK) | AWS KMS (`KMS_ADAPTER=aws`, [ADR 0020](adr/0020-reference-cloud-aws.md)) | Adaptador listo; **no probado contra AWS real** |
| Correo | SMTP del dominio de la organización | Ver [configurar correo](runbooks/configure-mail.md) |
| Respaldos de la base | Servidor dedicado | **Por definir** (decisión pendiente) |

Restricción vigente: **una sola réplica** de la API ([ADR 0039](adr/0039-single-instance-until-redis.md), [runbook](runbooks/single-instance-operation.md)).

### 2.2 Antes de empezar

- Un servidor para Dokploy: según su documentación, al menos 2 GB de RAM y 30 GB de disco, con los puertos 80, 443 y 3000 libres (Ubuntu 22.04/24.04 y Debian 11/12 figuran entre las distribuciones probadas). Fuente: <https://docs.dokploy.com/docs/core/installation>.
- Un dominio propio con un registro DNS hacia el servidor de Dokploy.
- Un servidor PostgreSQL dedicado, alcanzable solo desde el servidor de Dokploy (firewall) y con TLS.
- Una clave simétrica de AWS KMS y un usuario IAM con permisos mínimos sobre ella (`kms:GenerateDataKey` y `kms:Decrypt`). Fuera de AWS no hay rol IAM: el SDK usará las claves de acceso de ese usuario.
- Un SMTP del dominio.

### 2.3 Instalar Dokploy

En el servidor, como lo indica su documentación (la ejecuta una persona, es un comando de red):

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Después abre `http://<ip-del-servidor>:3000` y crea la cuenta de administración. Instala Docker si falta. Cierra el puerto 3000 al público cuando tengas dominio para el panel.

### 2.4 Preparar la base de datos (una vez)

Detalle de los roles en [`database.md`](database.md) §3.

1. Con una conexión de administrador del clúster, crea la base y ejecuta el `bootstrap` de roles (idempotente):

   ```bash
   pnpm --filter @iam/db build
   DATABASE_URL='postgres://<admin>@<host>/<base>' node db/dist/cli.js bootstrap
   ```

2. Los roles `iam_migrator` e `iam_app` se crean **sin login**. Asígnales `LOGIN` y una contraseña generada, guardada en tu gestor de secretos (`iam_auth_reader` no inicia sesión nunca):

   ```sql
   ALTER ROLE iam_migrator LOGIN PASSWORD '<secreto>';
   ALTER ROLE iam_app LOGIN PASSWORD '<secreto>';
   ```

3. Restringe `pg_hba.conf` y el firewall para que solo entre el servidor de Dokploy, y exige TLS.

### 2.5 Aplicar migraciones (cada despliegue, ANTES de arrancar la nueva versión)

Se aplican con el rol `iam_migrator`, nunca con `iam_app`:

```bash
pnpm build
MIGRATION_DATABASE_URL='postgres://iam_migrator:<secreto>@<host>/<base>' node apps/api/dist/main.migrate.js
```

(`main.migrate` es el punto de entrada de migraciones de la API; el CLI `node db/dist/cli.js migrate` con `DATABASE_URL` hace lo mismo.) Hazlo desde una máquina de operaciones con el repositorio en el **mismo commit** que vas a desplegar. No guardes `MIGRATION_DATABASE_URL` en las variables de la aplicación de Dokploy: el contenedor de la API no debe poder migrar. La documentación de Dokploy que se revisó **no describe un paso previo al despliegue** (solo un `Run Command` que corre cuando la aplicación ya está construida y en marcha), así que el orden es manual: migrar y luego desplegar. Es seguro porque las migraciones siguen el patrón expandir y contraer ([`database.md`](database.md) §1): la versión vieja sigue funcionando con el esquema nuevo.

### 2.6 Crear la aplicación en Dokploy

1. Crea un proyecto y dentro una **Application**.
2. **Source**: tu proveedor de Git (GitHub, GitLab, etc.) o la URL del repositorio y la rama `main`. Para un repositorio privado usa SSH o el proveedor conectado.
3. **Build Type**: `Dockerfile`. `Dockerfile Path`: `Dockerfile`. `Docker Context Path`: `.` (la raíz; el `Dockerfile` necesita todo el monorepo).
4. **Environment** (variables de ejecución; son secretas, no las pongas como argumentos de construcción):

   | Variable | Valor |
   | --- | --- |
   | `DATABASE_URL` | Conexión **directa** (sin PgBouncer en modo transacción) con el rol `iam_app`. Con TLS, normalmente `?sslmode=require` |
   | `APP_ORIGIN` | `https://<tu-dominio>` exacto: se usa para CSRF, enlaces de correo y WebAuthn |
   | `KMS_ADAPTER` | `aws` |
   | `AWS_KMS_KEY_ID`, `AWS_REGION` | Id, ARN o alias de la clave y su región |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Del usuario IAM con permisos mínimos (las lee el SDK de AWS, no la app) |
   | `MAIL_TRANSPORT` | `smtp`, con `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` |
   | `TRUST_PROXY` | Ver 2.8 |
   | `WEBAUTHN_RP_NAME`, `LOG_LEVEL`, `DB_POOL_MAX` | Opcionales (ver `apps/api/src/app/config.ts`) |

   La imagen ya fija `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000` y `WEB_DIST_DIR`. La API falla al arrancar si la configuración es inválida y el error nombra la variable, nunca su valor.

5. **Domains**: `Host` = tu dominio, `Container Port` = `3000`, `HTTPS` activado y `Certificate` = `letsencrypt`. Fuente: <https://docs.dokploy.com/docs/core/domains>.
6. **Deploy**.

### 2.7 Una sola réplica y orden de actualización

- Déjala en 1 réplica, sin autoescalado.
- La API toma un candado en PostgreSQL al arrancar: una segunda instancia termina con `RUNTIME.SECOND_INSTANCE`. Por eso una actualización que arranque la nueva **antes** de detener la vieja falla. En Dokploy (Advanced → Cluster Settings → Swarm Settings → *Update Config*) usa el orden `stop-first`. **No verificado:** la documentación revisada solo muestra el ejemplo `start-first`; confirma que `stop-first` está disponible y probado en tu versión. Si el contenedor nuevo falla por el candado, configura reintentos de arranque (ver el [runbook](runbooks/single-instance-operation.md)).
- No publiques el puerto de la API en el servidor: que solo se llegue por el proxy del dominio.

### 2.8 `TRUST_PROXY`

Dokploy pone un proxy (Traefik) delante. Para que el límite por IP use la IP real del cliente, define `TRUST_PROXY` según el [runbook](runbooks/single-instance-operation.md) paso 4: la IP o el CIDR del proxy, o `1` solo si la API es inalcanzable sin pasar por él. **Por verificar en tu despliegue:** la IP que ve la API desde Traefik y que Traefik reemplaza `X-Forwarded-For`. Sin esa comprobación déjalo en `false`.

### 2.9 Salud

La imagen trae un `HEALTHCHECK` que consulta `GET /api/v1/health/live` (solo indica que el proceso responde; no comprueba base de datos ni KMS). Dokploy también admite una comprobación de salud en *Swarm Settings → Health Check*; no hace falta duplicarla.

### 2.10 Alta de la primera organización

Sigue [Dar de alta una organización](runbooks/provision-organization.md): el comando necesita una conexión de **administrador** (`PROVISION_DATABASE_URL`) y imprime secretos una sola vez, así que no lo ejecutes en un lugar que registre la salida. Se puede correr con la misma imagen (`node apps/api/dist/main.provision.js`) desde una terminal privada de operaciones.

### 2.11 Verificar el despliegue

- `https://<tu-dominio>` carga la web con certificado válido.
- Hay una sola réplica y los registros muestran `http server listening` sin errores de KMS.
- La Raíz entra, cambia su contraseña y registra su segundo factor.
- La invitación llega por correo real y el enlace usa `APP_ORIGIN`.
- Una llave de acceso (passkey) se registra en el dominio real.

### 2.12 Reversión

Redespliega el commit anterior. Las migraciones no se revierten: se corrigen con una migración nueva ([`database.md`](database.md) §1).

## 3. Qué no está verificado

- **El `Dockerfile` nunca se construyó**: ni la construcción en dos etapas, ni `corepack`, ni el tamaño (la imagen conserva dependencias de desarrollo), ni el `HEALTHCHECK`, ni la ruta `/api/v1/health/live` dentro del contenedor.
- **Dokploy**: los datos de esta guía salen de su documentación pública, no de un ensayo. No encontré un paso previo al despliegue, el valor por defecto del puerto del contenedor ni confirmación de `stop-first`.
- **AWS KMS real**, **TLS a PostgreSQL** (`sslmode` en la cadena de conexión) y la IP que ve la API tras Traefik.
- **Respaldos**: la estrategia y su ensayo siguen pendientes (ver [restaurar un respaldo](runbooks/restore-backup.md)). No cargues credenciales reales hasta cerrar la fase 1 y la prueba de penetración externa.
- `main.migrate` y `db/dist/cli.js` se leyeron en el código pero no se ejecutaron para esta guía.
