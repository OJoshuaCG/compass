# Guía de backend

Reglas de arquitectura, código y operación de `apps/api` (NestJS + TypeScript). Complementa a `plan.md`: si algo aquí contradice al plan en seguridad, manda el plan. El contrato con el frontend (paginación, errores, idempotencia) está alineado con [`frontend.md`](frontend.md). Las reglas de negocio que el backend implementa están explicadas en [`business/`](business/README.md).

Esta guía describe reglas y decisiones; no incluye código. Cuando una regla se apoya en una pieza concreta del repositorio, se indica la ruta del archivo.

## 1. Principios

1. **El dominio no conoce el framework.** NestJS, el acceso a datos, Redis y el KMS son detalles reemplazables.
2. **Una sola puerta por responsabilidad.** Autorizar lo hace el motor de autorización; cifrar, el servicio de cifrado; auditar, el registro de auditoría. Nadie reimplementa esos pasos.
3. **Falla cerrada.** Sin contexto de organización, sin permiso, sin auditoría o sin KMS, la acción no ocurre.
4. **Lo que no tiene lint o prueba, se rompe.** Cada regla de esta guía indica cómo se verifica.
5. **Los secretos nunca salen del módulo de cifrado.** No se registran, no se serializan, no se devuelven fuera de la acción que los revela.
6. **Entradas no confiables en los bordes.** Todo dato externo se valida con Zod antes de entrar a la aplicación.

## 2. Stack

La lista aprobada está en el plan (sección "Stack tecnológico y bibliotecas aprobadas"): Node.js LTS, TypeScript en modo estricto, NestJS con Fastify, PostgreSQL 16+, Drizzle, BullMQ + Redis, Zod, `jose`, `@node-rs/argon2`, `@simplewebauthn/server`, `otplib`, `pino`, OpenTelemetry.

> **Estado de dependencias:** instaladas con versión exacta y publicadas hace más de 7 días (`minimumReleaseAge` de pnpm). Fase 0: `uuidv7`, `unplugin-swc` + `@swc/core` (Vitest necesita emitir metadatos de decoradores para los controladores de Nest), `dependency-cruiser`, `fastify` y `@fastify/helmet`. Fase 1a, en `apps/api`: `@simplewebauthn/server` (passkeys), `nodemailer` (correo SMTP, con `@types/nodemailer`), `@node-rs/argon2`, `otplib`, `jose`, `rate-limiter-flexible` (hoy en memoria: no hay cliente de Redis ni BullMQ instalados), `@fastify/cookie`, `@fastify/static` y `@zxcvbn-ts/*` (fortaleza de contraseñas); su contraparte en el navegador, `@simplewebauthn/browser`, está en `apps/web`. **Sigue pendiente** un generador de OpenAPI desde Zod (por ejemplo `@asteasolutions/zod-to-openapi`). Para el tipo de resultado, el validador Zod de peticiones y la configuración de entorno se escribió código propio pequeño.
>
> **Versiones relevantes:** TypeScript **6.0.3** (no 7: `typescript-eslint` 8.72 solo admite versiones inferiores a 6.1.0) y NestJS 12, que es **solo ESM**; por eso todo el monorepo es ESM (módulos `NodeNext`, imports relativos con extensión `.js`).

## 3. Arquitectura

### 3.1 Decisión: hexagonal por módulo, sí

El plan ya la fija (ADR 001) y conviene mantenerla en el backend por tres razones concretas de este producto:

- **Hay reglas de seguridad que deben ser TypeScript puro y 100 % probables** (matriz de jerarquía, motor de decisión, versiones de secretos). Aislarlas del framework permite pruebas unitarias exhaustivas y mutación (Stryker) sin levantar Nest ni base de datos.
- **Los adaptadores sí cambiarán**: KMS local / AWS (y quizá GCP o Azure, ADR 020), correo, SMS, Redis.
- **El monolito se podrá partir** (ADR 001) porque los módulos solo se hablan por fachadas y eventos.

Matices para que no se vuelva ceremonia:

- **CQRS ligero** (plan): los *comandos* pasan por el dominio; las *consultas* de listado leen proyecciones SQL directas, siempre con el filtro de acceso.
- **Un puerto existe cuando hay una razón real** (infraestructura externa o algo que se simula en pruebas). No se crean interfaces para clases internas con una sola implementación.
- Los módulos "futuros" (`federation`, `inbound-codes`, `broker`) nacen como carpetas con puertos y sin adaptadores, como indica el plan.

### 3.2 Capas y regla de dependencia

| Capa | Contiene | Puede importar |
| --- | --- | --- |
| `domain` | Entidades, objetos de valor, políticas, eventos, errores | Solo `domain` del módulo y `shared/kernel`. **Sin** NestJS, acceso a datos ni Node |
| `application` | Casos de uso, puertos, DTO internos | `domain` del módulo, fachadas públicas de otros módulos y `shared/kernel`. **Sin** decoradores de Nest |
| `infrastructure` | Repositorios, KMS, Redis, correo | `application`, `domain`, bibliotecas externas |
| `interface` | Controladores, SSE, procesadores de cola, mapeo a contratos | `application` del módulo y `packages/contracts` |
| Archivo de composición del módulo | **Raíz de composición**: une puertos con adaptadores | Todas las capas del módulo |

- Verificación en `apps/api`: restricciones de importación por capa en la configuración de ESLint (`apps/api/eslint.config.js`: domain y application sin Nest, acceso a datos ni módulos de Node; la criptografía de Node solo en el módulo `crypto`) y `dependency-cruiser` (`apps/api/.dependency-cruiser.cjs`) para la regla entre módulos (solo por la fachada) y los ciclos. `eslint-plugin-boundaries` se usa en `apps/web`. Ambas comprobaciones corren con `pnpm lint`.
- **Entre módulos**: solo por la fachada pública o por eventos de dominio vía outbox. Ningún módulo lee tablas ni repositorios de otro.
- **La criptografía de Node solo se importa en `modules/crypto`** (restricción de importación verificada por lint).

> **Extensión al plan:** el plan no nombra el archivo de composición de cada módulo. Se añade en la raíz de cada módulo porque es el único sitio donde el cableado de inyección de dependencias puede conocer todas las capas sin romper la regla de dependencia.

### 3.3 Estructura de un módulo

Cada módulo vive en `apps/api/src/modules/<modulo>/`. Tomando `vault` como ejemplo:

| Elemento | Qué contiene |
| --- | --- |
| Carpeta de dominio | Entidades y agregados (cuenta, credencial), objetos de valor (el nivel de compartición, con su orden USE < VIEW < EDIT < MANAGE), errores con códigos estables y eventos de dominio |
| Carpeta de aplicación | Un archivo por caso de uso, los puertos (interfaces de repositorios y de almacén de secretos) y los DTO internos |
| Carpeta de infraestructura | Implementaciones de los repositorios y las tablas del módulo |
| Carpeta de interfaz | El controlador y el mapeo de dominio a contrato |
| Archivo de composición del módulo | Raíz de composición: une puertos con adaptadores |
| Fachada pública | Único punto de entrada para otros módulos |
| `README.md` | Responsabilidad, fachada, eventos que emite y consume |
| `CLAUDE.md` | Solo en módulos protegidos |

### 3.4 `shared/kernel`

Lo único compartido por todos los módulos. Mantenerlo mínimo y sin lógica de negocio:

- El tipo de resultado (éxito o error) y sus dos constructores, de implementación propia y pequeña.
- El error de dominio base (código estable, mensaje, metadatos seguros).
- Tipos de marca para los identificadores (usuario, organización, credencial…).
- Puertos transversales: el reloj, el generador de identificadores (UUIDv7) y la lectura del contexto de petición.

Si una pieza de `shared/kernel` empieza a conocer un concepto de un módulo, pertenece a ese módulo.

### 3.5 Comunicación entre módulos

- **Síncrona**: `vault` llama al motor de autorización de `access` y al servicio de cifrado de `crypto` mediante sus fachadas. La fachada exporta **interfaces y casos de uso**, nunca entidades ni repositorios.
- **Asíncrona**: eventos de dominio en la tabla de salida (outbox), escritos en la misma transacción y publicados por el worker. Los consumidores son idempotentes (un evento puede llegar dos veces).
- **Prohibido**: importar repositorios, entidades o tablas de otro módulo.

### 3.6 Módulos de negocio implementados (fase 1a)

Además de `crypto`, `audit` y `organization` (fase 0), la fase 1a añadió seis módulos en `apps/api/src/modules/`. Los módulos con dependencias hacia otros solo las tienen a través de sus fachadas.

| Módulo | Responsabilidad en la fase 1a | Depende de |
| --- | --- | --- |
| `identity` (protegido) | Inicio de sesión con segundo factor, sesiones y cierre de sesión, reautenticación, alta del segundo factor (aplicación autenticadora) y códigos de recuperación, passkeys WebAuthn (ingreso y gestión; ver la tabla de endpoints de A2 y A3 más abajo), uso de los códigos de emergencia de la Raíz en el paso de recuperación, invitaciones (crear, previsualizar, aceptar), cambio de contraseña (`POST /auth/password/change`; el cambio obligatorio de la contraseña inicial bloquea el segundo factor con `403 AUTH.PASSWORD_CHANGE_REQUIRED`; audita `auth.password_changed` y `auth.password_change_failed`), política de contraseñas y política de intentos fallidos. Sus consultas previas a la autenticación usan las funciones mínimas del [ADR 0021](adr/0021-pre-authentication-access-with-rls.md) | `access`, `audit`, `crypto`, `directory`, `notification`, `organization` |
| `access` (protegido) | Catálogo de 27 permisos con techo de rango, plantillas de rol del sistema, permisos efectivos, no escalamiento de roles, función pura de decisión y el motor de autorización que audita cada negación ([ADR 0022](adr/0022-audit-of-denials-in-independent-transaction.md)) | `directory`, `audit` |
| `directory` | Usuarios, rangos, responsable y creador, regla de gestión, matriz de creación, alta de un usuario y listado del directorio con búsqueda, orden y paginación por cursor, y gestión de personas (`GET /users/managed` y `POST /users/:id/suspend`, `reactivate`, `deactivate`, `rank` y `manager`; audita `user.suspended`, `user.reactivated`, `user.deactivated`, `user.rank_changed` y `user.manager_changed`) | `organization` |
| `provisioning` | Alta de una organización por operaciones, con una conexión de administración: crea la organización, las plantillas de rol, la Raíz en estado invitada y su contraseña inicial en una sola transacción. Nunca se invoca desde una petición HTTP: lo ejecuta el comando de operaciones `pnpm --filter @iam/api provision` (variables `PROVISION_DATABASE_URL`, `ORG_NAME`, `ORG_SLUG`, `ROOT_EMAIL` y `ROOT_NAME`), que genera una contraseña inicial aleatoria, la imprime una sola vez y audita `organization.provisioned`. Genera además 8 códigos de emergencia de un solo uso para la Raíz (misma forma que los de recuperación), los imprime UNA vez junto a la contraseña inicial con la instrucción de imprimirlos y entregarlos a los dos custodios, y los guarda solo como hash con `kind = 'emergency'` | `access`, `identity` |
| `idempotency` | Protección contra peticiones de creación repetidas: reserva de la clave, respuesta guardada 24 horas e interceptor que la aplica a los `POST` marcados (ver §7.2.1 y el [ADR 0029](adr/0029-idempotency-reservation-and-ownership.md)) | `crypto`, `organization` |
| `notification` | Puerto de correo saliente. Envía las invitaciones y el aviso a los Administradores por uso de un código de emergencia. Adaptadores: SMTP del dominio de la organización (ver §6.3.1), uno de desarrollo que escribe el enlace en el registro (se niega a arrancar en producción) y uno en memoria para las pruebas | Ninguno |

Endpoints y auditoría añadidos al cerrar la fase 1a (A5, A6 y A7):

| Endpoint | Regla | Auditoría |
| --- | --- | --- |
| `GET /me/sessions` | Sesiones vivas de quien consulta: `id`, creación, última actividad, vencimiento, dispositivo, IP y marca `current`. Nunca devuelve tokens | — |
| `POST /me/sessions/:id/revoke` | `404` si la sesión no es suya o ya está cerrada; `422` si es la actual (para eso se usa el cierre de sesión) | `auth.session_revoked` |
| `POST /users/:id/sessions/revoke` | Cierra todas las sesiones de una persona gestionada. Permiso `user.deactivate`, reglas de jerarquía, Raíz protegida; toma el bloqueo de jerarquía | `user.sessions_revoked` |
| `GET /roles` | Requiere `user.invite` | — |
| `POST /roles` | Cuerpo `{name, permissions}`. Permiso `role.manage`. Los permisos deben ser subconjunto de los del creador (`403 AUTHZ.ROLE_ESCALATION`); nombre repetido sin distinguir mayúsculas, `409 ROLE.NAME_TAKEN`. Usa idempotencia | `role.created` |
| `POST /roles/:id/archive` | Permiso `role.manage`. Las plantillas del sistema no se archivan (`403 ROLE.SYSTEM_PROTECTED`). Un rol archivado deja de otorgar permisos y no sirve en invitaciones nuevas | `role.archived` |
| `GET /invitations` | Invitaciones pendientes propias; la Raíz ve todas; marca las vencidas | — |
| `POST /invitations/:id/resend` | Solo quien la envió o la Raíz. Revoca el enlace anterior, genera token nuevo con 72 h y lo envía por correo. Si la inserción falla, el anterior no queda revocado (retroceso ante conflicto). Usa idempotencia | `user.invitation_resent` |

Una sesión cuenta como viva si no está revocada, no ha vencido y tuvo actividad en los últimos 30 minutos.

Endpoints y auditoría añadidos con A2 (passkeys) y A3 (códigos de emergencia). WebAuthn con verificación de usuario obligatoria y sin atestación; el identificador de la parte confiable y el origen salen de `APP_ORIGIN`.

| Endpoint | Regla | Auditoría |
| --- | --- | --- |
| `POST /auth/passkey/options` | Tras la contraseña, entrega el desafío de ingreso. Desafío de 5 minutos, de un solo uso y ligado a la persona y al propósito. Pedirlo no cuenta como intento fallido. La respuesta del ingreso indica si la persona tiene passkeys | — |
| `POST /auth/passkey/verify` | Verifica la firma; el contador de firmas debe avanzar. Los fallos comparten el límite de intentos de la persona | `auth.passkey_login` |
| `GET /me/passkeys` | Passkeys de quien consulta. Nunca devuelve claves | — |
| `POST /me/passkeys/registration/options` | Sesión completa y reautenticación reciente. Máximo 10 por persona | — |
| `POST /me/passkeys/registration/verify` | Cuerpo con el nombre de la passkey. Sesión completa y reautenticación reciente | `auth.passkey_registered` |
| `POST /me/passkeys/:id/revoke` | Sesión completa y reautenticación reciente | `auth.passkey_revoked` |
| Paso de recuperación del ingreso (código de emergencia) | Solo después de la contraseña. Restablece el segundo factor de la Raíz (TOTP y códigos de recuperación ordinarios revocados), la deja en estado invitada con el registro del segundo factor pendiente (incluida la sesión que lo usó), cierra sus demás sesiones y envía el aviso por correo a cada Administrador activo después del *commit*. Los códigos de emergencia sin usar siguen vigentes; registrar un segundo factor nuevo reemite solo los códigos de recuperación ordinarios. No sustituye la contraseña | `auth.emergency_code_used` (crítico; con el número de destinatarios del aviso) y `auth.emergency_alert_incomplete` (si el correo falla o no hay destinatarios) |

Decisión del dueño (2026-10-27): solo quienes custodian los códigos pueden restablecer la Raíz; ningún Administrador puede hacerlo, solo recibe la alerta. Limitación: olvidar la contraseña Y perder los factores no tiene recuperación en el sistema; falta un procedimiento de operaciones.

### 3.7 Flujo de una petición autenticada

1. La petición llega con la cookie de sesión. Los proveedores globales se evalúan en este orden: límite por dirección de red (solo en las rutas marcadas), protección CSRF (cabecera personalizada y verificación de `Origin` en las peticiones que modifican) y guard de sesión.
2. El guard de sesión toma el token solo de la cookie, calcula su hash y busca la sesión con la función previa a la autenticación. Rechaza sin distinguir la causa si la sesión está revocada, vencida (absoluta), inactiva (30 minutos) o es de una persona que no está activa ni invitada. Si pasaron más de 60 segundos desde la última actividad, la actualiza con el reloj de la aplicación ([ADR 0025](adr/0025-session-time-single-clock-source.md)).
3. Si la sesión no completó el segundo factor, solo entra a las rutas marcadas como de sesión parcial (completar el segundo factor, registrarlo, cerrar sesión). En las demás, la respuesta indica si falta registrar o verificar el factor.
4. Un interceptor fija el contexto de la petición (organización, persona, sesión, frescura de la reautenticación) con datos de la sesión, nunca del cliente.
5. El controlador valida la entrada con Zod y llama a un caso de uso. El caso de uso abre la transacción con el contexto de organización, pide la decisión al motor de autorización, ejecuta la lógica, audita en la misma transacción y devuelve un resultado tipado.
6. Si el motor niega, registra la negación en una transacción independiente con su código de motivo y responde con el error estable. La reautenticación vencida se responde con un código específico que la interfaz reconoce para abrir su diálogo.

El guard de permisos como "primera barrera" (§7.2) **no está implementado**: hoy la autorización completa la hace el caso de uso con el motor.

### 3.8 Flujo de una invitación

1. **Crear.** Quien invita se autoriza con el permiso de invitar; se valida la matriz de creación y el no escalamiento de roles (cada negación se audita); se comprueba que el correo no exista; se revocan las invitaciones vencidas de ese correo; se genera un token de 256 bits y se guarda solo su hash; se envía el correo y se audita. Todo ocurre en una transacción: si el envío falla, no queda una invitación sin enviar. El token nunca vuelve a quien invita.
2. **Previsualizar.** La persona invitada abre el enlace y consulta, con el token en el cuerpo de una petición (nunca en la URL), el correo y el rango. Una invitación inexistente, vencida, usada o revocada responde igual.
3. **Aceptar.** Se valida la contraseña (mínimo 12 caracteres, sin reglas de composición, rechazo de comunes y de datos personales). En una transacción se bloquea la invitación, se revalida que siga vigente, que quien invitó siga activo y que todavía pueda otorgar los roles; se crea el usuario como invitado con quien invita como creador y responsable; se asigna la plantilla de su rango más los roles pedidos; se marca la invitación como usada y se emite una sesión parcial. Cualquier falla se ve igual que una invitación inválida.
4. **Segundo factor.** Con la sesión parcial, la persona pide el secreto (se guarda cifrado y sin verificar), confirma con un código, el sistema emite 10 códigos de recuperación (solo se guarda su hash), activa a la persona y marca la sesión con el segundo factor cumplido.

## 4. Dominio

- **TypeScript puro**, sin lecturas directas de la hora ni de azar: el tiempo y los identificadores llegan por el reloj y el generador de identificadores, para que las pruebas sean deterministas.
- **Agregados pequeños**, con invariantes en el constructor o en métodos de fábrica; no hay entidades "anémicas" que cualquiera mute desde fuera.
- **Objetos de valor inmutables** (nivel de compartición, rango, correo, URI de TOTP) que validan al crearse.
- **Tipos de marca** para todo identificador. Un identificador de usuario no es un identificador de credencial.
- **Errores esperados como resultado tipado**; las excepciones se reservan para lo inesperado (bug, caída). Cada error de dominio lleva un `code` estable (por ejemplo, el de "usuario fuera del subárbol de gestión"), que es la clave de traducción en la UI y una entrada de un catálogo versionado.
- **Políticas como funciones puras**: la regla de gestión entre actores, la matriz de creación y el no escalamiento viven en `domain` y se prueban con tablas.
- Los eventos de dominio son datos inmutables, sin referencias a infraestructura.

## 5. Aplicación

### 5.1 Casos de uso

- Una clase, un método de ejecución, un archivo, un nombre en imperativo (revelar contraseña, compartir cuenta, desactivar usuario).
- **Sin decoradores de Nest**: es una clase normal con sus dependencias por constructor. El cableado lo hace el archivo de composición del módulo con fábricas.
- Devuelve un resultado tipado; no lanza excepciones por reglas de negocio.
- No recibe el identificador de organización como argumento libre: lo lee del contexto de petición.

Ejemplo, el caso de uso de revelar una contraseña: recibe por constructor el motor de autorización, el repositorio de cuentas, el lector de secretos, la auditoría y la unidad de trabajo. Su único método abre la transacción, pide la decisión de autorización para el permiso de revelar sobre la credencial indicada y, si se niega, devuelve el error de la decisión. Solo si se permite lee el secreto con el propósito de revelación, audita y devuelve el resultado.

### 5.2 Flujo obligatorio de un caso de uso sensible

1. Abrir la transacción mediante la unidad de trabajo, que fija el contexto de organización de la base de datos.
2. Pedir la decisión al motor de autorización (los 7 pasos del plan). El guard del controlador es una red de seguridad, **no** la autorización.
3. Ejecutar la lógica de dominio.
4. Escribir la auditoría **en la misma transacción**. El número de secuencia, el hash anterior, el hash y la fecha los asigna un trigger de la base de datos con un bloqueo por organización: la aplicación nunca calcula el hash. La verificación de la cadena es una función de la propia base de datos (ver [`database.md`](database.md) §8).
5. Escribir los eventos de salida (outbox) en la misma transacción.
6. Cerrar la transacción. Si la auditoría falla, la acción falla.

### 5.3 Puertos

- Interfaces TypeScript en la carpeta de puertos de la capa de aplicación, nombradas por intención (repositorio de cuentas, puerto de gestión de claves), con documentación TSDoc obligatoria.
- Los puntos de inyección se identifican con un símbolo exportado junto a la interfaz.
- Los repositorios devuelven entidades de dominio, no filas ni tipos del acceso a datos.

### 5.4 Consultas (lectura)

- Pueden usar proyecciones SQL directas, **siempre** unidas a la vista de acceso efectivo. Prohibido cargar registros para filtrarlos en memoria.
- Cada consulta de listado declara su lista blanca de filtros y de campos ordenables (solo indexados).
- Paginación por cursor (sección 7.4).

## 6. Infraestructura

### 6.1 Base de datos (Drizzle + PostgreSQL)

- Esquemas de acceso a datos **por módulo**; ningún módulo importa el esquema de otro.
- Migraciones SQL versionadas en `db/migrations`, con RLS por tabla. **Nunca se edita una migración aplicada**: se crea otra.
- **Una tabla nueva** incluye en la misma migración la columna de organización, un índice compuesto que empieza por ella y la política RLS. Una prueba de CI lo verifica.
- Patrón *expandir y contraer*: primero se agrega, luego se retira lo viejo en otra migración.
- Dos roles: **aplicación** (sin saltarse RLS, no dueño de tablas; en la tabla de auditoría solo puede insertar y leer) y **migraciones**.
- Bajas lógicas; nada del dominio se borra físicamente salvo datos efímeros con TTL.
- Concurrencia optimista: cada agregado editable lleva un número de versión y las modificaciones por HTTP envían la versión esperada.

### 6.2 Transacciones y RLS

- La unidad de trabajo abre la transacción, fija el contexto de organización solo para esa transacción y publica la transacción actual en un almacenamiento local asíncrono; los repositorios la toman de ahí. **No hay acceso a la base de datos fuera de una transacción con contexto.**
- La organización sale del contexto de petición (sesión autenticada), nunca de un parámetro que envía el cliente.
- Una prueba de integración con **dos organizaciones** verifica, por repositorio, que A nunca lee, modifica ni cuenta filas de B. Corre en cada PR.

### 6.3 Otros adaptadores

- **KMS**: puerto de gestión de claves con adaptadores AWS y local. El local **se niega a arrancar** si el entorno es producción. En pruebas, un adaptador falso determinista.
- **Redis**: contadores, límites y colas. **Nunca** material criptográfico.
- **Correo y SMS**: detrás de puertos; el proveedor concreto es intercambiable.
- **Outbox**: el worker publica y marca la fecha de publicación; reintentos con *backoff*.

#### 6.3.1 Correo saliente (SMTP)

El correo de invitación sale por el servidor SMTP del dominio propio de la organización (decisión del dueño, 2026-10-27: no Gmail ni Outlook). Se configura con variables de entorno, validadas al arrancar:

| Variable | Valor |
| --- | --- |
| `MAIL_TRANSPORT` | `log` (desarrollo) o `smtp` (real). Producción EXIGE `smtp` |
| `SMTP_HOST` | Servidor SMTP del dominio |
| `SMTP_PORT` | 587 por defecto |
| `SMTP_SECURITY` | `starttls` (por defecto), `tls` o `none`. `none` se rechaza en producción |
| `SMTP_USER`, `SMTP_PASSWORD` | Se definen juntas |
| `MAIL_FROM` | Remitente del dominio propio, p. ej. `IAM <no-reply@sudominio>` |
| `APP_ORIGIN` | Origen de la aplicación; de él salen el identificador de la parte confiable y el origen de WebAuthn |
| `WEBAUTHN_RP_NAME` | Opcional; nombre que ve la persona al registrar una passkey. Por defecto `IAM` |

Reglas del adaptador SMTP: STARTTLS obligatorio, certificado verificado, TLS 1.2 como mínimo y tiempos límite. Los errores del proveedor se sustituyen por uno genérico (pueden citar destinatario o contenido) y los errores de configuración nunca repiten valores. El correo se redacta en es-MX o en-US según la persona destinataria; el enlace lleva el token en el fragmento (`#token=`) y el vencimiento se indica en UTC. Probado contra un servidor SMTP de pruebas real en un contenedor. Para la entregabilidad, el dominio necesita registros SPF, DKIM y DMARC en el DNS (fuera del sistema).

#### 6.3.2 Resto de las variables de entorno de la API

Fuente de verdad: `apps/api/src/app/config.ts` (no existe `.env.example`). Las de correo, `APP_ORIGIN` y `WEBAUTHN_RP_NAME` están en §6.3.1.

| Variable | Valor por defecto | Para qué |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` o `production`. En producción se exige `MAIL_TRANSPORT=smtp` y el adaptador de claves local se niega a arrancar |
| `HOST` y `PORT` | `127.0.0.1` y `3000` | Dirección y puerto de escucha |
| `LOG_LEVEL` | `info` | Nivel de `pino` |
| `DATABASE_URL` | Ninguno | Conexión del rol de aplicación. Obligatoria para arrancar la API |
| `DB_POOL_MAX` | `10` | Tamaño del pool de conexiones (1 a 100) |
| `LOCAL_KMS_KEY_FILE` | `.local-kms/kek.key` | Archivo de la clave del adaptador de desarrollo; no sirve en producción |
| `WEB_DIST_DIR` | Ninguno | Carpeta de la SPA compilada; si se omite, la API no sirve el frontend |
| `TRUST_PROXY` | `false` | Solo detrás de un balanceador de confianza: toma la IP del cliente de `X-Forwarded-For` |

El comando de alta de organizaciones usa sus propias variables (`PROVISION_DATABASE_URL`, `ORG_NAME`, `ORG_SLUG`, `ROOT_EMAIL` y `ROOT_NAME`; ver §3.6) y las migraciones usan `DATABASE_URL` con el rol de migraciones ([`database.md`](database.md) §1).

## 7. Interfaz HTTP (NestJS)

### 7.1 Controladores

- **Delgados**: validan la entrada, llaman a **un** caso de uso y mapean el resultado a un contrato. Sin lógica de negocio.
- Validación con un pipe de Zod propio sobre los esquemas de `packages/contracts`. Prohibido `class-validator`.
- El guard de permisos aplica el paso 3 como red de seguridad, no como autorización completa.
- Nunca se devuelven entidades de dominio: siempre un mapeo al contrato.

### 7.2 Proveedores globales

Registrados una sola vez en el módulo raíz, en este orden de responsabilidad:

1. Middleware del identificador de petición y creación del contexto de petición.
2. Guard de sesión (cookie `__Host-session`) y protección CSRF (cabecera personalizada más verificación del origen).
3. Guard de permisos. *Pendiente: en la fase 1a la autorización la hace el caso de uso con el motor.*
4. Idempotencia (respuesta guardada 24 h) para las peticiones que crean recursos. **Implementada** (A7), ver §7.2.1.

Orden efectivo en la fase 1a: límite por dirección de red, protección CSRF, guard de sesión y un interceptor que fija el contexto de la petición (ver §3.7).
5. Filtro global de excepciones: traduce los errores de dominio y los errores conocidos a **detalles de problema (RFC 9457)**; cualquier otra excepción responde un `500` genérico con el identificador de petición, sin detalles internos.

#### 7.2.1 Idempotencia

- Las peticiones `POST` que crean recursos exigen la cabecera `Idempotency-Key` (8 a 200 caracteres: letras, dígitos y `. _ : -`). Hoy se aplica a `POST /invitations`, `POST /invitations/:id/resend` y `POST /roles`. El cliente web ya la envía.
- La respuesta se guarda 24 horas por organización, actor y clave (tabla `idempotency_keys`). Un reintento con la misma clave y la misma petición devuelve la misma respuesta con la cabecera `Idempotent-Replayed: true` y sin crear nada de nuevo.
- Errores: misma clave con otra petición, `422 IDEMPOTENCY.KEY_REUSED`; clave ausente o inválida, `422 IDEMPOTENCY.KEY_REQUIRED`; petición original aún en curso, `409 IDEMPOTENCY.IN_PROGRESS`.
- La reserva dura 1 minuto, para que una petición caída no bloquee la clave durante un día. La toma de una reserva vencida es atómica y una petición original lenta no puede sobrescribir a un dueño más reciente. Si guardar la respuesta falla después del *commit*, la clave no se libera.
- Las respuestas de error no se guardan: el reintento se ejecuta de nuevo.
- **Nunca** se usa en endpoints cuya respuesta lleve secretos, porque la respuesta se guarda tal cual.
- Limitaciones conocidas: las filas vencidas aún no se purgan (falta un trabajo de limpieza) y el reintento no vuelve a comprobar permisos durante las 24 horas.

### 7.3 Errores

Cada error sigue el formato de detalles de problema (RFC 9457) y lleva cinco datos: un tipo (dirección de referencia del error), un título legible, el estado HTTP, el `code` estable (por ejemplo, el de "el usuario no está en el subárbol de gestión") y el identificador de la petición.

- `code` estable y documentado en el catálogo; es la clave de traducción de la UI.
- Nunca se filtra SQL, rutas ni trazas.
- `404` en lugar de `403` cuando el usuario no debe saber que el recurso existe.
- Validación: `422` con la lista de campos inválidos.
- Conflicto de versión: `409`. Reautenticación requerida: `403` con código específico que la UI reconoce para abrir el diálogo.

### 7.4 Convenciones de la API

- REST bajo `/api/v1`, recursos en plural y en inglés; las acciones que no son CRUD son sub-recursos con verbo (por ejemplo, revelar una credencial).
- **Paginación por cursor**, alineada con la tabla estándar del frontend:
  - La petición lleva cursor, límite, campo de orden y dirección. El límite máximo es **100** (valores del frontend: 10, 25, 50, 100); por defecto 25.
  - La respuesta trae la lista de datos y un bloque de página con el cursor siguiente (o nulo), el límite usado y, opcionalmente, el total.
  - El cliente guarda la pila de cursores para retroceder; la API **no** necesita un cursor "anterior". El total es opcional y solo si el endpoint lo calcula de forma barata.
  - El cursor es opaco, firmado y de corta vida.
- El orden solo se admite por campos indexados y de lista blanca; un campo no permitido responde `422`.
- Fechas ISO 8601 UTC. El identificador de petición va en cada respuesta.
- Eventos en tiempo real por SSE (`/api/v1/events`).
- Contratos Zod en `packages/contracts` y OpenAPI generado de ellos. Un cambio incompatible crea `v2` del recurso afectado.

### 7.5 Respuestas con secretos

Solo la acción dedicada (revelar, código 2FA, exportar) devuelve un secreto, con la cabecera de no almacenamiento en caché. Nunca aparece en listados ni en detalles.

## 8. Buenas prácticas de NestJS

- **Puntos de entrada, una imagen**: `main.http.ts` (API), `main.migrate.ts` (migraciones) y `main.provision.ts` (alta de organizaciones por operaciones), con comandos de arranque distintos, todos en `apps/api/src`. El del worker (colas y outbox) está planeado y aún no existe.
- **Fastify** como adaptador. Los plugins de Fastify (cabeceras de seguridad, cookies) se registran en el punto de entrada de la API, no en módulos de dominio.
- **Módulos por funcionalidad**: un módulo de Nest por módulo de dominio; solo exporta lo que la fachada declara.
- **Inyección por constructor**, con símbolos para los puertos. Prohibida la inyección por propiedad y la obtención de dependencias "al vuelo" desde el módulo de referencia.
- **Sin referencias circulares**: el uso de referencias diferidas es señal de que dos módulos están mal separados; se resuelve con un evento o moviendo la responsabilidad.
- **Configuración**: variables de entorno validadas al arrancar con un esquema Zod propio; el servicio no arranca con configuración inválida. Los secretos de infraestructura vienen del gestor de secretos, nunca de archivos de entorno ni del repositorio.
- **Ciclo de vida**: cierre ordenado (drenar peticiones, cerrar pool y colas). Las comprobaciones de salud distinguen vida (*liveness*) y disponibilidad (*readiness*).
- **Workers**: los procesadores de BullMQ viven en la capa de interfaz del módulo, delegan en un caso de uso y son idempotentes, con reintentos y *backoff* acotados.
- **Decoradores de Nest solo en la capa de interfaz y en el archivo de composición.** Si aparecen en `domain` o `application`, el lint falla.
- **Sin estado global mutable** en servicios; la caché de claves de datos es la única excepción y vive en `crypto` (con TTL y límite de usos, ver plan).

## 9. TypeScript

- La configuración base está en `packages/config` e incluye: modo estricto, acceso indexado que admite valores ausentes, propiedades opcionales exactas, sobrescritura explícita, errores capturados como desconocidos, retorno explícito en todas las ramas y prohibición de caídas entre casos de un selector.
- Prohibido `any` (lint como error). Se usa `unknown` y validación con Zod en los bordes.
- Tipos de marca para identificadores; uniones discriminadas para estados y resultados.
- Configuraciones tipadas con comprobación de forma; catálogos (permisos, códigos de error) como constantes inmutables.
- Sin `enum` de TypeScript para datos que viajan por la red: se usan uniones de literales o constantes inmutables (el catálogo de permisos del plan es una enumeración versionada en código; se mantiene así por decisión del plan y se deriva de ella su tipo de unión).
- Prohibidos los archivos de reexportación en carpetas intermedias; solo la fachada del módulo exporta.
- Importaciones de solo tipos donde corresponda; ciclos de importación prohibidos (dependency-cruiser).
- Nombres en inglés en el código; comentarios y documentación en español. Los comentarios explican **por qué**, no qué.

## 10. Seguridad (invariantes)

Todo archivo de los módulos protegidos (`identity`, `access`, `crypto`, `audit`) abre con un comentario titulado "Invariantes de seguridad" que lista, en viñetas, lo que nunca debe romperse en ese archivo.

Reglas que aplican a todo el backend:

- **Nunca** registrar secretos, tokens, cookies ni cuerpos de rutas sensibles (revelación, códigos, handoff).
- **Todo acceso a un secreto declara su propósito** (revelar, código TOTP, exportar o inyectar); se autoriza y audita por propósito. El propósito de inyección está deshabilitado hasta la fase del broker.
- **Tokens** (sesión, invitación, handoff): 256 bits aleatorios; en base de datos solo su SHA-256.
- **Contraseñas**: Argon2id (`@node-rs/argon2`); nunca cifradas ni registradas.
- **Comparaciones de secretos y hashes** en tiempo constante.
- **JWT con `jose`**: lista blanca de algoritmos; nunca se confía en el algoritmo que declara el token.
- **Cifrado**: AES-256-GCM, nonce aleatorio de 12 bytes por operación y datos asociados que ligan el texto cifrado a su organización, credencial, campo y versión. Solo el servicio de cifrado.
- **Rate limiting** por usuario, IP y acción (`rate-limiter-flexible` sobre Redis); mensajes idénticos para usuario inexistente o contraseña incorrecta. *Estado en la fase 1a:* el límite por IP (60 por minuto en las rutas de autenticación e invitación) y los contadores de intentos fallidos por correo y por usuario viven en la memoria de cada instancia; el adaptador de Redis está pendiente ([ADR 0026](adr/0026-atomic-failed-attempt-counting.md)).
- **Auditoría**: append-only, encadenada por hash; sin secretos, ni parciales; los metadatos pasan por una lista blanca de campos.
- El correo entrante (fase 4) y los datos externos son **entrada no confiable**: nunca se renderiza HTML, se ignoran adjuntos y hay límites de tamaño y tiempo.

## 11. Observabilidad y logs

- `pino` en JSON con identificador de petición, organización, actor, módulo y caso de uso, tomados del contexto de petición.
- Redacción por configuración de los campos de contraseña, secreto, token, TOTP, código, autorización, cookie, texto cifrado y clave de datos envuelta, y de los cuerpos de las rutas sensibles.
- Una prueba envía secretos conocidos por los endpoints sensibles y verifica que no aparecen en los logs capturados.
- Logs técnicos y auditoría son cosas distintas: los logs se muestrean; la auditoría es evidencia y nunca se pierde.
- OpenTelemetry: trazas y métricas de negocio y seguridad (revelaciones, códigos 2FA, llamadas al KMS, aciertos de caché de claves, negaciones por código).

## 12. Pruebas

| Tipo | Herramienta | Qué cubre |
| --- | --- | --- |
| Unitarias de dominio | Vitest | Políticas, entidades, objetos de valor. 90 % de ramas en módulos protegidos |
| Matriz de autorización | Vitest, tabla generada | Cada actor × rango × relación × acción. 100 % de combinaciones |
| Mutación | Stryker | `access` y `crypto` (mínimo 80 %) |
| Integración | Vitest + Testcontainers | Repositorios, RLS, transacciones, auditoría, colas (PostgreSQL y Redis reales) |
| Aislamiento de tenants | Testcontainers | Dos organizaciones; ningún cruce |
| Contrato | Zod + OpenAPI | La API cumple su contrato |
| Arquitectura | `eslint-plugin-boundaries`, dependency-cruiser | Regla de dependencia |
| Seguridad | Semgrep, gitleaks, osv-scanner, Trivy | SAST, secretos, dependencias, imágenes |

- **Casos de uso**: se prueban con puertos falsos en memoria (sin Nest ni base de datos). Los repositorios se prueban con PostgreSQL real.
- **Controladores**: pruebas de integración HTTP con la inyección de peticiones de Fastify, contra una base de datos real.
- **Reloj e identificadores deterministas**: se usan versiones falsas de ambos.
- **Criptografía**: vectores conocidos (AES-GCM, RFC 6238 para TOTP) y pruebas negativas (datos asociados alterados, nonce reutilizado, clave incorrecta, texto truncado).
- **Auditoría**: cada caso de uso sensible verifica el evento exacto que escribe; prueba de falla cerrada; cadena de hashes verificada tras operaciones concurrentes.
- **Matriz de autorización**: la escribe o la revisa una persona como código de producción (ver sección 14).
- Las pruebas de integración usan contenedores efímeros; ningún dato real fuera de producción.
- Vitest se divide en dos proyectos: uno unitario, sin contenedores, y otro de integración, con un PostgreSQL 17 por ejecución y una base por archivo, migrada con el rol de migraciones y usada con el rol de aplicación. Los comandos exactos de ejecución, incluido el uso de Podman, están en el [`README.md`](../README.md) raíz.
- Comandos de `@iam/api`: `pnpm --filter @iam/api test:unit` (sin contenedores) y `pnpm --filter @iam/api test:integration` (necesita Podman o Docker). `pnpm e2e` ejecuta las pruebas en Chrome real contra la pila completa. Los totales verificados por paquete están en [`handoff.md`](handoff.md) §1.
- La validación de la configuración (`apps/api/src/app/config.ts`) también se prueba: una combinación inválida de variables de correo o de producción impide el arranque.

## 13. Flujo de trabajo

- Trunk-based con ramas de vida corta; Conventional Commits; PR pequeños. Plantilla de PR con lista de seguridad (autorización, auditoría, secretos en logs, filtro de organización, pruebas de matriz).
- Toda PR requiere revisión humana; las que tocan rutas protegidas requieren dos.
- `CODEOWNERS`: `modules/identity`, `modules/access`, `modules/crypto`, `modules/audit`, migraciones con RLS, configuración de CSP y cabeceras.
- Cada módulo tiene `README.md` (responsabilidad, fachada pública, eventos que emite y consume); los módulos protegidos, además, un `CLAUDE.md`.
- Cada decisión de arquitectura nueva se registra como ADR en `docs/adr/`.
- Dependencias: versiones exactas, lockfile, instalación con lockfile congelado en CI, espera de 7 días tras cada publicación, scripts de instalación deshabilitados con lista blanca.

## 14. Trabajo con agentes

Se puede apoyar el desarrollo del backend en los agentes de Claude Code disponibles a nivel global. Son una ayuda para ejecutar: **todo lo que produzcan debe cumplir esta guía y pasar revisión humana**.

### Agentes y para qué sirven

| Agente | Úsalo para | Límites |
| --- | --- | --- |
| `general-purpose` | Implementar un caso de uso, repositorio o controlador con sus pruebas, cuando el alcance está acotado | Escribe código; necesita rutas permitidas explícitas |
| `typescript-pro` | Tipos de marca, tipos genéricos del resultado, tipos derivados de `contracts`, utilidades tipadas | Solo tipos y utilidades; no decide arquitectura |
| `Explore` | Mapear dónde vive algo o cómo fluye una petición, sin tocar nada | Solo lectura |
| `Plan` | Diseñar la implementación de una funcionalidad antes de escribirla | No escribe archivos |
| `review-risk` | Revisar seguridad, permisos, exposición de datos y dependencias | Revisión; no corrige |
| `review-resilience` | Revisar reintentos, fallas parciales, transacciones, concurrencia | Revisión; no corrige |
| `review-reliability` | Revisar valor y determinismo de las pruebas, bordes y regresiones | Revisión; no corrige |
| `review-readability` | Revisar nombres, complejidad y tamaño del cambio | Revisión; no corrige |
| `git` | Commits granulares con Conventional Commits | Pide confirmar el alcance antes de preparar archivos |

No hay un agente específico de backend: la implementación la hace `general-purpose` con un encargo preciso. La revisión (`review-*`) es independiente de quien escribió el código.

### Cómo delegar

1. **Apunta a la guía por referencia**: "lee `docs/backend.md` y `plan.md` (secciones X e Y) antes de escribir". No se parafrasean las reglas.
2. **Alcance explícito de archivos**: rutas que puede crear o editar (por ejemplo, el archivo del caso de uso y su prueba dentro del módulo). Nada fuera de ellas.
3. **Una unidad de comportamiento por encargo**: caso de uso, puertos y pruebas juntos; no se parte el mismo comportamiento entre agentes.
4. **Reutilizar antes de crear**: nombrar las piezas existentes (motor de autorización, auditoría, unidad de trabajo, servicio de cifrado, tipo de resultado) y los invariantes que deben mantener.
5. **Criterios de aceptación y comando de verificación** en el encargo (sección 15).
6. El agente informa qué archivos tocó, qué comprobó y qué no pudo comprobar.

### Lo que los agentes no hacen

- **No agregan dependencias**: proponen y se detienen.
- **No escriben en módulos protegidos** (`identity`, `access`, `crypto`, `audit`), migraciones con RLS ni configuración de CSP y cabeceras, salvo encargo humano explícito. Sí pueden **revisarlos**.
- **No editan migraciones ya aplicadas.**
- **No leen archivos de entorno** ni datos de producción; no ejecutan comandos de red ni de despliegue.
- **No escriben las pruebas de la matriz de autorización** ni las de criptografía y aislamiento de tenants sin revisión humana línea por línea: si quien escribe el código escribe también la prueba, puede codificar el mismo error en ambos.
- **No marcan como terminado** lo que no comprobaron.

### Revisión

- En rutas protegidas se revisa línea por línea con dos personas; "las pruebas pasan" no basta.
- Tras un cambio sensible (autorización, criptografía, auditoría, transacciones), se usan los revisores `review-*` pertinentes como segunda opinión independiente y sus hallazgos se triagean antes de actuar.

## 15. Definición de terminado (backend)

- [ ] Respeta las capas y la fachada del módulo; lint de límites en verde.
- [ ] Caso de uso sensible: pasa por el motor de autorización, audita en la misma transacción y emite eventos por outbox.
- [ ] Toda consulta pasa por repositorios con contexto de organización; sin SQL fuera de RLS.
- [ ] Entradas validadas con Zod; errores de dominio con `code` en el catálogo.
- [ ] Sin secretos en logs, respuestas ni errores.
- [ ] Pruebas: unitarias de dominio; integración con PostgreSQL real si toca repositorios; matriz si toca autorización; aislamiento de tenants si añade tablas o listados.
- [ ] Tabla nueva: columna de organización, índice y política RLS en la misma migración.
- [ ] Contratos y OpenAPI actualizados; claves i18n de los códigos de error nuevos en el frontend.
- [ ] Lint, tipos, pruebas y análisis de seguridad en verde.
- [ ] README del módulo y ADR actualizados si cambió una decisión.

## 16. Decisiones pendientes

Hallazgos del análisis del plan y pendientes tras la fase 1a. Los ADR 0021 y 0022 se aceptaron e implementaron en la fase 1a; el ADR 0023 se aceptó el 2026-10-27 y el 0024 (`docs/adr/`) sigue en estado **Propuesta**; se decide antes de implementar el módulo afectado.

Resueltas en la fase 1a:

- [x] **Acceso previo a la autenticación con RLS** (ADR 0021): aceptada e implementada. El módulo `identity` consume las funciones mínimas del esquema `auth` (migración 0008).
- [x] **Auditoría de negaciones** (ADR 0022): aceptada e implementada. Cada negación se registra en una transacción independiente. Queda abierta la agrupación de negaciones repetidas y qué hacer si esa escritura falla.
- [x] **Tiempo de las sesiones** (ADR 0025) e **intentos fallidos contados de forma atómica** (ADR 0026): aceptadas e implementadas.

Pendientes de la fase 1a:

- [x] **Passkeys (WebAuthn)** (A2): hechas, opcionales para todos y varias por persona; tabla `webauthn_challenges` (migración 0011, [ADR 0028](adr/0028-passkeys-optional-enforcement-later.md) y [ADR 0030](adr/0030-session-bound-webauthn-challenges.md)). Revisadas por dos jueces ciegos (hallazgos corregidos); pendiente la purga de desafíos vencidos. La reautenticación sigue aceptando solo el código de la aplicación autenticadora. Exigirlas a la Raíz y a los Administradores queda como futura configuración de la organización (aún no hay pantalla de configuración).
- [x] **Cambio obligatorio de la contraseña inicial de la Raíz** (A4): hecho.
- [x] **Códigos de emergencia de la Raíz** (A3): hechos (migración 0010, columna `kind`; [ADR 0027](adr/0027-emergency-codes-root-reset-model.md)). Decisión del dueño: solo los custodios pueden restablecer la Raíz; ningún Administrador. Limitación: olvidar la contraseña Y perder los factores no tiene recuperación en el sistema, y no hay forma de emitir códigos de emergencia nuevos. Sigue pendiente el restablecimiento de factores por el responsable.
- [ ] **Redis para los límites de intentos y por IP**: hoy son por instancia y en memoria. Sin Redis, el sistema debe operar con una sola instancia (ver el [runbook](runbooks/single-instance-operation.md)). No entró en la entrega de correo; el dueño solo respondió sobre el correo.
- [ ] **Trabajo de limpieza de datos temporales**: las filas vencidas de `idempotency_keys` y de `webauthn_challenges` no se purgan. Necesita el camino para recorrer organizaciones de `docs/database.md` §7.5.
- [ ] **Adaptador de KMS de proveedor y worker**: solo existe el adaptador local, que se niega a arrancar con `NODE_ENV=production`, y no hay punto de entrada de worker (`apps/api/src` tiene API, migraciones y alta de organizaciones). Dependen de la decisión de proveedor de nube.
- [x] **Correo real** (A8, parte de correo): adaptador SMTP del dominio propio (§6.3.1). Siguen pendientes los demás avisos por correo (dispositivo nuevo, uso de un código de recuperación, cambios de factores).
- [ ] **CI en GitHub y escáneres** (A9): despriorizada por el dueño (2026-10-27), no bloqueada; el repositorio ya tiene remoto y el flujo de `.github/workflows/ci.yml` nunca se ha ejecutado allí.
- [x] **Idempotencia** de las peticiones que crean recursos (§7.2.1, A7): hecha. Limitaciones: sin purga de filas vencidas y sin nueva comprobación de permisos en el reintento.
- [ ] **Guard de permisos** como primera barrera (§7.2).
- [x] **Comando de operaciones** para dar de alta una organización y registrar el alta en la auditoría (A3), ahora también con los códigos de emergencia.
- [x] **Gestión de personas** (A1) y **gestión de sesiones propias y ajenas** (A5): hechas. Sigue pendiente transferir la Raíz.
- [x] **Roles personalizados e invitaciones** (A6): crear y archivar roles, elegirlos al invitar y reenviar invitaciones. Sigue pendiente editar un rol ya creado.

Pendientes de fases posteriores:

- [ ] **Bloqueo de auditoría** (ADR 0023): el trigger mantiene el bloqueo por organización hasta el *commit*. Evaluar el impacto en transacciones largas.
- [ ] **Retención de auditoría** (ADR 0024) frente al borrado revocado: definir particionado o un rol de archivado.
- [ ] **Índice ciego derivado de la clave de datos**: el plan deriva el índice ciego y las huellas de contraseña de la clave de datos. Al rotarla cambian todos los valores, así que cada rotación obliga a recalcular los índices (y, mientras conviven versiones, a buscar con ambas). El servicio de cifrado ya informa la versión de clave usada. Decidir si se deriva de una clave por organización estable en lugar de la clave de datos.
- [ ] **Generador de OpenAPI** desde Zod: aprobar la dependencia.
- [ ] **Versión de PostgreSQL**: las pruebas usan 17; evaluar 18 si ya está disponible en el proveedor (UUIDv7 nativo).
- [ ] **`oidc-provider` sobre Fastify** (fase 2): está basado en Koa; validar con un *spike* antes de comprometerse.
- [ ] **Trabajos en segundo plano multi-organización**: se necesita un camino para listar organizaciones sin contexto (función de listado propuesta en `docs/database.md` §7.5).
