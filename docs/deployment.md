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
- Para una base persistente en vez de la temporal de `pnpm stack`, sigue la sección 1.1.
- En local el adaptador de claves es `local` (archivo `.local-kms/kek.key`, ignorado por git). No sirve en producción: la API se niega a arrancar así.

## 1.1 Correr la API local contra una base de pruebas externa

La API y la web corren en tu equipo; los datos viven en un PostgreSQL de **pruebas** en otro servidor y no se borran al detener la API. Las credenciales van en dos archivos que git ignora: `.env.setup.local` (preparación, una sola vez) y `.env.local` (lo único que lee la API).

> **Solo una base de pruebas.** Nunca apuntes esto a producción ni cargues credenciales reales en la bóveda: la fase 1b no está iniciada.

### Antes de empezar

| Necesitas | Por qué |
| --- | --- |
| Node 24 y `pnpm install` hecho | Los scripts usan `node --env-file`, que viene con Node |
| Una base vacía en el servidor de pruebas | Las migraciones crean todo el esquema |
| Un administrador dueño de la base con `CREATEROLE` | Crear los roles y dar de alta la organización |
| Acceso de red de tu equipo al puerto de PostgreSQL | `listen_addresses`, `pg_hba.conf` y el firewall del servidor deben permitir tu IP |
| Que **ninguna otra API** use esa base | La API toma un candado al arrancar; con otra viva, la tuya termina con `RUNTIME.SECOND_INSTANCE` |

La base, el administrador y el acceso de red se preparan una sola vez en [Preparar el servidor de pruebas](#preparar-el-servidor-de-pruebas-una-vez).

### Preparar el servidor de pruebas (una vez)

Lo hace quien administra el servidor, **en el servidor**, con el usuario del sistema `postgres`. Al terminar hay una base vacía, un administrador para los scripts de preparación y acceso de red solo desde tu equipo. Si ya seguiste otra guía de instalación, no reutilices su rol dueño ni su esquema propio: Compass crea sus roles y usa los esquemas `public` y `auth`.

1. Crea el administrador y la base. `--pwprompt` pide la contraseña sin dejarla en el historial:

   ```bash
   sudo -u postgres createuser --login --createrole --pwprompt compass_admin
   sudo -u postgres createdb --owner=compass_admin --encoding=UTF8 --template=template0 compass
   ```

   `compass_admin` es dueño de la base y tiene `CREATEROLE`: basta para `local:bootstrap` sin darle poder sobre el resto del clúster. No uses el rol `postgres` en las cadenas de conexión: en una instalación estándar solo entra por el socket local (`peer`), no por red.

2. Haz que PostgreSQL escuche en la interfaz por la que llegas desde tu equipo (por ejemplo, la IP del servidor en tu VPN), nunca en todas (`*`). En Debian y Ubuntu ponlo en un archivo propio dentro de `/etc/postgresql/<versión>/main/conf.d/`; en Fedora y RHEL, en `postgresql.conf` dentro del directorio de datos:

   ```ini
   listen_addresses = 'localhost,<ip-del-servidor>'
   ```

   Este parámetro exige reiniciar el servicio, no basta recargar.

3. Permite en `pg_hba.conf` solo tu IP, solo la base `compass`, solo los roles que inician sesión y siempre con contraseña:

   ```text
   # TYPE  DATABASE  USER                                ADDRESS               METHOD
   host    compass   compass_admin,iam_migrator,iam_app  <ip-de-tu-equipo>/32  scram-sha-256
   ```

   - Tu IP es la que muestra el error `no pg_hba.conf entry for host "<ip>"`, o la que da `tailscale ip -4` en tu equipo si usas Tailscale.
   - Con TLS en el servidor, usa `hostssl` en vez de `host` y deja `?sslmode=require` en las cadenas. Sin TLS, conéctate solo por una red privada cifrada (una VPN como Tailscale o WireGuard) y quita `?sslmode=require`.
   - Nunca uses `trust`, `0.0.0.0/0` ni rangos amplios: cualquiera en esa red podría intentar entrar.

   Recarga la configuración y revisa que no haya errores de sintaxis (la consulta debe devolver cero filas):

   ```bash
   sudo systemctl reload postgresql   # en Debian y Ubuntu: postgresql@<versión>-main
   sudo -u postgres psql -c "SELECT line_number, error FROM pg_hba_file_rules WHERE error IS NOT NULL;"
   ```

4. Abre el puerto 5432 en el firewall del servidor solo para tu IP o para la interfaz de la VPN.

**Resultado esperado:** desde tu equipo, `pnpm local:bootstrap` (paso 2 de la ruta rápida) termina sin errores. Si falla, busca el mensaje en [Si algo falla](#si-algo-falla).

### Ruta rápida

1. Copia las plantillas y llena los valores:

   ```bash
   cp .env.setup.example .env.setup.local
   cp .env.example .env.local
   ```

2. Crea los roles (una vez por servidor; es idempotente): `pnpm local:bootstrap`.
3. Dales login a los dos roles que inician sesión, con contraseñas generadas, desde una sesión de administrador (`psql` u otro cliente):

   ```sql
   ALTER ROLE iam_migrator LOGIN PASSWORD '<contraseña-generada>';
   ALTER ROLE iam_app LOGIN PASSWORD '<contraseña-generada>';
   ```

   Pon la de `iam_migrator` en `MIGRATION_DATABASE_URL` de `.env.setup.local` y la de `iam_app` en `DATABASE_URL` de `.env.local`.

4. Aplica las migraciones: `pnpm local:migrate`. Repítelo cada vez que bajes cambios con migraciones nuevas.
5. Da de alta la organización de pruebas (una vez): `pnpm local:provision`. Imprime **una sola vez** la contraseña inicial de la Raíz y ocho códigos de emergencia; cópialos antes de cerrar la terminal.
6. Arranca la plataforma: `pnpm local:api`. Compila API y web y sirve todo en `http://localhost:3000`.
7. Entra con `ROOT_EMAIL` y la contraseña inicial. Se te pedirá cambiarla y registrar el segundo factor (TOTP).

**Resultado esperado:** el registro muestra `http server listening` y la app carga en `http://localhost:3000`.

### Qué hace cada script

| Script | Lee | Conecta como | Cuándo |
| --- | --- | --- | --- |
| `local:bootstrap` | `.env.setup.local` (`DATABASE_URL`) | Administrador | Una vez por servidor |
| `local:migrate` | `.env.setup.local` (`MIGRATION_DATABASE_URL`) | `iam_migrator` | Tras bajar migraciones nuevas |
| `local:provision` | `.env.setup.local` (`PROVISION_DATABASE_URL`, `ORG_*`, `ROOT_*`) | Administrador | Una vez por organización |
| `local:api` | `.env.local` | `iam_app` | Cada vez que trabajas |

Los archivos van separados a propósito: la API nunca arranca con credenciales capaces de crear roles, migrar o dar de alta organizaciones (igual que en el despliegue, §2.5).

### Detalles que conviene saber

- **Correo:** con `MAIL_TRANSPORT=log` los enlaces de invitación y restablecimiento aparecen en el registro de la API, no en un buzón.
- **Clave de cifrado:** la primera vez se crea `.local-kms/kek.key`. Los secretos de la bóveda que guardes solo se descifran con ese archivo. Si lo borras, o si otra persona usa la misma base con su propia clave, esos secretos quedan ilegibles. Si comparten la base, compartan también el archivo por un canal seguro, nunca por git.
- **Dirección:** abre siempre `http://localhost:3000`, no `127.0.0.1`. `APP_ORIGIN` debe coincidir exactamente: WebAuthn y la protección contra CSRF lo comparan.
- **Interfaz con recarga en vivo:** `pnpm local:api` sirve la web compilada. Si cambias la interfaz, vuelve a ejecutarlo; el servidor de Vite (`pnpm --filter @iam/web dev`) no está configurado para hablar con esta API.
- **TLS:** si el servidor exige TLS, deja `?sslmode=require` en las cadenas de conexión.
- **PgBouncer:** conéctate directo a PostgreSQL. En modo transacción el candado de instancia única no funciona.

### Si algo falla

| Síntoma | Causa probable |
| --- | --- |
| `permission denied to create role` | El usuario de `DATABASE_URL` en `.env.setup.local` no tiene `CREATEROLE` o no es dueño de la base: [Preparar el servidor](#preparar-el-servidor-de-pruebas-una-vez), paso 1 |
| `no pg_hba.conf entry for host "<ip>", ...` | El servidor no permite esa IP, base o rol: paso 3 de Preparar el servidor. `no encryption` indica que la conexión fue sin TLS, así que la línea debe ser `host`, no `hostssl` |
| `The server does not support SSL connections` | El servidor no tiene TLS: quita `?sslmode=require` y usa una red privada cifrada |
| `connect ECONNREFUSED` o tiempo agotado | PostgreSQL no escucha en esa interfaz o el firewall bloquea: pasos 2 y 4 de Preparar el servidor |
| `Invalid configuration: <variable>: ...` | Falta esa variable en `.env.local` o tiene un formato inválido |
| `could not acquire the single-instance lock, check DATABASE_URL and the database` | Credenciales, red o TLS; prueba la conexión con `psql` y la misma cadena |
| `RUNTIME.SECOND_INSTANCE` o `another API instance already holds the single-instance lock for this database` | Otra API (tuya o de alguien más) está conectada a esa base. En Dokploy suele ser el despliegue con `start-first`: ver [§2.7](#27-una-sola-réplica-y-orden-de-actualización) |
| `role "iam_app" is not permitted to log in` | Falta el paso 3 |
| `relation ... does not exist` | Faltan migraciones: `pnpm local:migrate` |
| La app carga pero no deja entrar | Abriste una dirección distinta de `APP_ORIGIN` |

### No verificado

Esta ruta se armó a partir del código y de `pnpm stack`; todavía **no se ha ensayado contra un servidor externo real**, en particular TLS y el login con `NODE_ENV=development` sobre `http://localhost`. Tampoco se ha comprobado que `local:provision` funcione con un administrador que no es superusuario (las tablas tienen RLS forzado y pertenecen a `iam_migrator`); si falla con `permission denied`, dale a `compass_admin` el atributo `SUPERUSER` solo mientras corre el comando y quítaselo al terminar.

## 2. Despliegue en Dokploy

### 2.1 Qué se despliega

| Pieza | Dónde | Estado |
| --- | --- | --- |
| API + web (una imagen, un contenedor) | Dokploy, construida con el `Dockerfile` de la raíz | Imagen construida y probada con Podman en local; **sin ensayar en Dokploy** (§3) |
| PostgreSQL | Servidor dedicado, fuera de Dokploy | Por provisionar |
| Claves (KEK) | AWS KMS (`KMS_ADAPTER=aws`, [ADR 0020](adr/0020-reference-cloud-aws.md)) | Adaptador listo; **no probado contra AWS real**. La API comprueba el acceso a la clave al arrancar y no arranca si falla (ver la sonda de arranque en [`backend.md`](backend.md) §6) |
| Correo | SMTP del dominio de la organización | Ver [configurar correo](runbooks/configure-mail.md) |
| Sondeo de correo entrante (`inbound-poll`) | Proceso periódico aparte, programado desde el anfitrión; el contenedor solo arranca la API (`docker/start.sh` ejecuta `main.http.js`) | Opcional, solo si se usan los códigos entrantes. Entorno y rol propios; ver [programar el sondeo](runbooks/inbound-poll.md). **Sin ensayar contra un servidor IMAP real** |
| Respaldos de la base | Servidor dedicado | `pg_dump` cada hora a Wasabi (RPO de 1 h, RTO de 4 h; decidido el 2026-11-04). El trabajo programado y la retención: **por definir** |

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

2. Los roles `iam_migrator` e `iam_app` se crean **sin login**. Asígnales `LOGIN` y una contraseña generada, guardada en tu gestor de secretos (`iam_auth_reader` no inicia sesión nunca). El `bootstrap` también crea `iam_inbound_worker`, el rol del sondeo de correo entrante: también nace sin login, y solo necesita `LOGIN` si vas a programar `inbound-poll` (ver su [runbook](runbooks/inbound-poll.md)):

   ```sql
   ALTER ROLE iam_migrator LOGIN PASSWORD '<secreto>';
   ALTER ROLE iam_app LOGIN PASSWORD '<secreto>';
   -- Solo si programas el sondeo de correo entrante:
   ALTER ROLE iam_inbound_worker LOGIN PASSWORD '<secreto>';
   ```

3. Restringe `pg_hba.conf` y el firewall para que solo entre el servidor de Dokploy, y exige TLS.

### 2.5 Aplicar migraciones (cada despliegue, ANTES de arrancar la nueva versión)

Se aplican con el rol `iam_migrator`, nunca con `iam_app`:

```bash
pnpm build
MIGRATION_DATABASE_URL='postgres://iam_migrator:<secreto>@<host>/<base>' node apps/api/dist/main.migrate.js
```

(`main.migrate` es el punto de entrada de migraciones de la API; el CLI `node db/dist/cli.js migrate` con `DATABASE_URL` hace lo mismo.) Hazlo desde una máquina de operaciones con el repositorio en el **mismo commit** que vas a desplegar. No guardes `MIGRATION_DATABASE_URL` en las variables de la aplicación de Dokploy: el contenedor de la API no debe poder migrar. La documentación de Dokploy que se revisó **no describe un paso previo al despliegue** (solo un `Run Command` que corre cuando la aplicación ya está construida y en marcha), así que el orden es manual: migrar y luego desplegar. Es seguro porque las migraciones siguen el patrón expandir y contraer ([`database.md`](database.md) §1): la versión vieja sigue funcionando con el esquema nuevo.

**Los roles de sistema se sincronizan solos al arrancar.** Si la versión nueva cambió las plantillas de roles (`SYSTEM_ROLES`), las organizaciones existentes conservan los permisos anteriores hasta correr `sync-system-roles` ([runbook](runbooks/provision-organization.md)). El comando de arranque de la imagen lo corre antes de levantar la API, con la misma `DATABASE_URL` (rol `iam_app`), así que no hace falta ningún paso manual ni credencial adicional.

| Resultado | Qué pasa |
| --- | --- |
| Termina bien | Imprime solo conteos (organizaciones, roles actualizados, fallos) y arranca la API |
| Falla una vez (por ejemplo, un corte breve de la base) | Reintenta: hasta 3 intentos, con 5 s entre uno y otro |
| Falla los 3 intentos (base inalcanzable, migraciones sin aplicar, una organización que no se pudo sincronizar) | Sale con código 1, la API **no arranca** y el contenedor queda en error. Con `stop-first` (§2.7) la versión vieja ya se detuvo: corrige la causa o revierte (§2.12) |

El arranque lo hace [`docker/start.sh`](../docker/start.sh), que también atiende `SIGTERM` durante la sincronización y la espera entre intentos, así que detener el contenedor nunca queda colgado. Es idempotente: si no hay cambios en las plantillas, no modifica nada ni escribe auditoría. Para correrlo a mano en un contenedor que ya está en marcha: `docker exec <contenedor-de-la-api> node apps/api/dist/main.sync-system-roles.js`.

### 2.6 Crear la aplicación en Dokploy

1. Crea un proyecto y dentro una **Application**.
2. **Source**: tu proveedor de Git (GitHub, GitLab, etc.) o la URL del repositorio y la rama `main`. Para un repositorio privado usa SSH o el proveedor conectado.
3. **Build Type**: `Dockerfile`. `Dockerfile Path`: `Dockerfile`. `Docker Context Path`: `.` (la raíz; el `Dockerfile` necesita todo el monorepo).
4. **Environment** (variables de ejecución; son secretas, no las pongas como argumentos de construcción). La plantilla para copiar y pegar es [`.env.dokploy.example`](../.env.dokploy.example): pega su contenido y reemplaza cada `<valor>`. Las opcionales van comentadas; no las dejes vacías, porque una variable vacía impide arrancar a la API.

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
   | `OUTBOX_WORKER_ENABLED`, `OUTBOX_POLL_INTERVAL_MS` | Opcionales; el publicador del outbox está apagado por defecto (ver `docs/backend.md` §6.5). **Con él apagado no sale el aviso por correo a la Raíz cuando alguien revela un restablecimiento de códigos entrantes**: el aviso viaja por el outbox. Si usas los códigos entrantes, pon `OUTBOX_WORKER_ENABLED=true` |

   La imagen ya fija `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000` y `WEB_DIST_DIR`. La API falla al arrancar si la configuración es inválida y el error nombra la variable, nunca su valor.

5. **Domains**: `Host` = tu dominio, `Container Port` = `3000`, `HTTPS` activado y `Certificate` = `letsencrypt`. Fuente: <https://docs.dokploy.com/docs/core/domains>.
6. **Deploy**.

### 2.7 Una sola réplica y orden de actualización

- Déjala en 1 réplica, sin autoescalado.
- La API toma un candado en PostgreSQL al arrancar: una segunda instancia termina con `RUNTIME.SECOND_INSTANCE`. Por eso una actualización que arranque la nueva **antes** de detener la vieja falla. En Dokploy (Advanced → Cluster Settings → Swarm Settings → *Update Config*) usa el orden `stop-first`. **No verificado:** la documentación revisada solo muestra el ejemplo `start-first`; confirma que `stop-first` está disponible y probado en tu versión. Si el contenedor nuevo falla por el candado, configura reintentos de arranque (ver el [runbook](runbooks/single-instance-operation.md)).

**Por qué `start-first` falla (observado en staging, Dokploy 0.29.12).** Con el orden por defecto, Swarm arranca la tarea nueva mientras la vieja sigue viva y no detiene la vieja hasta que la nueva está sana. La nueva no puede tomar el candado, registra `another API instance already holds the single-instance lock for this database` y sale con código 1 (`task: non-zero exit (1)` en `docker service ps`). La vieja sigue atendiendo con las variables de entorno del despliegue anterior, así que un cambio como corregir `APP_ORIGIN` no surte efecto aunque el panel muestre el despliegue como hecho. En el log de la interfaz se ve la excepción de la tarea nueva, y el contenedor vivo no es el que la produjo. Esperar o reintentar el candado en la tarea nueva no lo resuelve, porque nunca llega a estar sana. Esa última parte es una deducción del comportamiento de `start-first` y no se probó.

**Configuración de Swarm para esta API** (en *Swarm Settings*; el equivalente en un compose es `deploy.update_config` y `deploy.rollback_config`):

| Ajuste | Valor | Para qué |
| --- | --- | --- |
| Update Config → `Order` | `stop-first` | Detiene la tarea vieja antes de arrancar la nueva, así el candado ya está libre |
| Update Config → `FailureAction` | `rollback` | Si la versión nueva no arranca, Swarm vuelve a la anterior en lugar de dejar el servicio caído |
| Restart Policy | unos pocos reintentos con espera corta | Cubre el instante en que PostgreSQL tarda en soltar el candado de la conexión anterior |
| Stop Grace Period | el plazo de apagado ordenado de la API | La API atiende `SIGTERM` y cierra su conexión, que es lo que libera el candado |

**Costo que se acepta:** con `stop-first` hay un corte de unos segundos en cada despliegue, y si la versión nueva falla y no hay rollback, el servicio queda caído hasta corregirla. Es consecuencia de la instancia única (ADR 0039); desaparece cuando haya Redis y varias réplicas. En producción despliega en una ventana tranquila y con el rollback activado.

**Verificar tras desplegar:**

1. `docker service ps <servicio> --no-trunc`: solo una tarea con estado `Running` y ninguna reciente en `Failed`.
2. Dentro del contenedor vivo, `printenv APP_ORIGIN` (no ejecutes `env` a secas: imprime secretos) y compara con la variable guardada en Dokploy.

**Estado de verificación:** que `stop-first` y `rollback` aparezcan en la interfaz de Dokploy 0.29.12 lo confirmó la persona que opera el staging. Aún no se registró un despliegue completo con esa configuración, ni se probó el rollback.
- No publiques el puerto de la API en el servidor: que solo se llegue por el proxy del dominio.

### 2.8 `TRUST_PROXY`

Dokploy pone un proxy (Traefik) delante. Para que el límite por IP use la IP real del cliente, define `TRUST_PROXY` según el [runbook](runbooks/single-instance-operation.md) paso 4: la IP o el CIDR del proxy, o `1` solo si la API es inalcanzable sin pasar por él. **Por verificar en tu despliegue:** la IP que ve la API desde Traefik y que Traefik reemplaza `X-Forwarded-For`. Sin esa comprobación déjalo en `false`.

### 2.9 Salud

La imagen trae un `HEALTHCHECK` que consulta `GET /api/v1/health/live` (solo indica que el proceso responde; no comprueba base de datos ni KMS). Dokploy también admite una comprobación de salud en *Swarm Settings → Health Check*; no hace falta duplicarla.

### 2.10 Alta de la primera organización

La vía recomendada es el **enlace de configuración inicial** ([ADR 0046](adr/0046-first-root-one-time-setup.md)): no necesita conexión de administrador ni rol con `BYPASSRLS`.

1. Genera un token y ponlo en las variables de entorno de la aplicación en Dokploy: `FIRST_SETUP_TOKEN` (`openssl rand -hex 32`; mínimo 32 caracteres; evita caracteres que un navegador pueda alterar en el enlace). Redespliega.
2. Abre `<APP_ORIGIN>/setup#token=<valor>` en el navegador. El token va en el fragmento (`#`), así que no llega al servidor ni a los registros del proxy; la página lo quita de la barra de direcciones al cargar.
3. Captura el nombre y el identificador de la organización, el nombre y el correo de la persona Raíz y su contraseña. La respuesta muestra **una sola vez** los códigos de emergencia (grupos A y B): imprímelos y entrega cada grupo a un custodio distinto.
4. **Borra `FIRST_SETUP_TOKEN`** y redespliega. Aunque se quedara, el enlace ya no funciona: la base de datos rechaza la operación si existe cualquier organización.

Cualquier fallo (token equivocado, variable ausente, alta ya hecha) responde `404` idéntico; el motivo real queda solo en el registro del servidor, sin el token ni la contraseña.

La alternativa es [Dar de alta una organización](runbooks/provision-organization.md) con el comando de operaciones: necesita una conexión de **administrador** (`PROVISION_DATABASE_URL`) e imprime secretos una sola vez, así que no lo ejecutes en un lugar que registre la salida. Se puede correr con la misma imagen (`node apps/api/dist/main.provision.js`) desde una terminal privada de operaciones.

### 2.11 Verificar el despliegue

- `https://<tu-dominio>` carga la web con certificado válido.
- Hay una sola réplica y los registros muestran `http server listening` sin errores de KMS.
- Al inicio de los registros del contenedor aparece la línea de conteos de `sync-system-roles` con `organizaciones con fallo: 0` (§2.5).
- La Raíz entra, cambia su contraseña y registra su segundo factor.
- La invitación llega por correo real y el enlace usa `APP_ORIGIN`.
- Una llave de acceso (passkey) se registra en el dominio real.

### 2.12 Reversión

Redespliega el commit anterior. Las migraciones no se revierten: se corrigen con una migración nueva ([`database.md`](database.md) §1).

## 3. Qué no está verificado

- **La imagen se construyó y probó con Podman en local (2026-11-02), no en Dokploy.** Resultados:

  | Prueba | Resultado |
  | --- | --- |
  | Primera construcción | 1 min 45 s; imagen de 330 MB |
  | Reconstrucción con solo cambios de código | 42 s; dependencias desde caché, ninguna descarga |
  | `bootstrap`, `migrate` (27 aplicadas; la segunda vez, 0) y `provision` con la imagen | Correctos |
  | Arranque sin migraciones | `sync-system-roles` falla, el contenedor sale con código 1 y la API no arranca |
  | Base inalcanzable | 3 intentos con 5 s de espera; sale con código 1 a los 13 s |
  | Base caída al arrancar que vuelve a los 3 s | El segundo intento sincroniza y la API arranca |
  | `SIGTERM` durante la espera entre intentos o con la conexión colgada | 0.2 s, código 143 |
  | Arranque normal | Conteos de sincronización, `http server listening`; salud, web y rutas de la app responden 200; `HEALTHCHECK` sano; unos 280 MB de memoria |
  | Rol de sistema desalineado y reinicio | Lo corrige (`roles de sistema actualizados: 1`) y audita `role.system_synced` |
  | Apagado con `SIGTERM` con la API levantada | 0.2 a 0.4 s, código 0 (la API es el proceso principal) |
  | Permisos | Corre como `node` y no puede escribir en `/app` |

  La prueba usó `NODE_ENV=development` con KMS local y correo por registro, porque producción exige AWS KMS y SMTP reales. Podman ignora el `HEALTHCHECK` con el formato OCI; Docker (el de Dokploy) lo respeta. **Falta verificar en Dokploy** que marque el despliegue como fallido cuando el contenedor sale con error.
- **Dokploy**: los datos de esta guía salen de su documentación pública, no de un ensayo. No encontré un paso previo al despliegue, el valor por defecto del puerto del contenedor ni confirmación de `stop-first`.
- **AWS KMS real**, **TLS a PostgreSQL** (`sslmode` en la cadena de conexión) y la IP que ve la API tras Traefik.
- **Respaldos**: la estrategia está decidida (`pg_dump` cada hora a Wasabi, RPO de 1 h y RTO de 4 h; 2026-11-04) y su ensayo sigue pendiente (ver [restaurar un respaldo](runbooks/restore-backup.md)). No cargues credenciales reales hasta cerrar la fase 1 y la prueba de penetración externa.
- `main.migrate` y `db/dist/cli.js` se leyeron en el código pero no se ejecutaron para esta guía.
