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

- **CQRS ligero** (plan): los _comandos_ pasan por el dominio; las _consultas_ de listado leen proyecciones SQL directas, siempre con el filtro de acceso.
- **Un puerto existe cuando hay una razón real** (infraestructura externa o algo que se simula en pruebas). No se crean interfaces para clases internas con una sola implementación.
- Los módulos "futuros" (`federation`, `inbound-codes`, `broker`) nacen como carpetas con puertos y sin adaptadores, como indica el plan.

### 3.2 Capas y regla de dependencia

| Capa                              | Contiene                                                    | Puede importar                                                                                         |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `domain`                          | Entidades, objetos de valor, políticas, eventos, errores    | Solo `domain` del módulo y `shared/kernel`. **Sin** NestJS, acceso a datos ni Node                     |
| `application`                     | Casos de uso, puertos, DTO internos                         | `domain` del módulo, fachadas públicas de otros módulos y `shared/kernel`. **Sin** decoradores de Nest |
| `infrastructure`                  | Repositorios, KMS, Redis, correo                            | `application`, `domain`, bibliotecas externas                                                          |
| `interface`                       | Controladores, SSE, procesadores de cola, mapeo a contratos | `application` del módulo y `packages/contracts`                                                        |
| Archivo de composición del módulo | **Raíz de composición**: une puertos con adaptadores        | Todas las capas del módulo                                                                             |

- Verificación en `apps/api`: restricciones de importación por capa en la configuración de ESLint (`apps/api/eslint.config.js`: domain y application sin Nest, acceso a datos ni módulos de Node; la criptografía de Node solo en el módulo `crypto`) y `dependency-cruiser` (`apps/api/.dependency-cruiser.cjs`) para la regla entre módulos (solo por la fachada) y los ciclos. `eslint-plugin-boundaries` se usa en `apps/web`. Ambas comprobaciones corren con `pnpm lint`.
- **Entre módulos**: solo por la fachada pública o por eventos de dominio vía outbox. Ningún módulo lee tablas ni repositorios de otro.
- **La criptografía de Node solo se importa en `modules/crypto`** (restricción de importación verificada por lint).

> **Extensión al plan:** el plan no nombra el archivo de composición de cada módulo. Se añade en la raíz de cada módulo porque es el único sitio donde el cableado de inyección de dependencias puede conocer todas las capas sin romper la regla de dependencia.

### 3.3 Estructura de un módulo

Cada módulo vive en `apps/api/src/modules/<modulo>/`. Tomando `vault` como ejemplo:

| Elemento                          | Qué contiene                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carpeta de dominio                | Entidades y agregados (cuenta, credencial), objetos de valor (el nivel de compartición, con su orden USE < VIEW < EDIT < MANAGE), errores con códigos estables y eventos de dominio |
| Carpeta de aplicación             | Un archivo por caso de uso, los puertos (interfaces de repositorios y de almacén de secretos) y los DTO internos                                                                    |
| Carpeta de infraestructura        | Implementaciones de los repositorios y las tablas del módulo                                                                                                                        |
| Carpeta de interfaz               | El controlador y el mapeo de dominio a contrato                                                                                                                                     |
| Archivo de composición del módulo | Raíz de composición: une puertos con adaptadores                                                                                                                                    |
| Fachada pública                   | Único punto de entrada para otros módulos                                                                                                                                           |
| `README.md`                       | Responsabilidad, fachada, eventos que emite y consume                                                                                                                               |
| `CLAUDE.md`                       | Solo en módulos protegidos                                                                                                                                                          |

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

| Módulo                 | Responsabilidad en la fase 1a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Depende de                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `identity` (protegido) | Inicio de sesión con segundo factor, sesiones y cierre de sesión, reautenticación, alta del segundo factor (aplicación autenticadora) y códigos de recuperación, passkeys WebAuthn (ingreso y gestión; ver la tabla de endpoints de A2 y A3 más abajo), uso de los códigos de emergencia de la Raíz en el paso de recuperación, invitaciones (crear, previsualizar, aceptar), cambio de contraseña (`POST /auth/password/change`; el cambio obligatorio de la contraseña inicial bloquea el segundo factor con `403 AUTH.PASSWORD_CHANGE_REQUIRED`; audita `auth.password_changed` y `auth.password_change_failed`), política de contraseñas y política de intentos fallidos. Sus consultas previas a la autenticación usan las funciones mínimas del [ADR 0021](adr/0021-pre-authentication-access-with-rls.md) | `access`, `audit`, `crypto`, `directory`, `notification`, `organization` |
| `access` (protegido)   | Catálogo de 28 permisos con techo de rango, plantillas de rol del sistema, permisos efectivos, no escalamiento de roles, función pura de decisión y el motor de autorización que audita cada negación ([ADR 0022](adr/0022-audit-of-denials-in-independent-transaction.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `directory`, `audit`                                                     |
| `directory`            | Usuarios, rangos, responsable y creador, regla de gestión, matriz de creación, alta de un usuario y listado del directorio con búsqueda, orden y paginación por cursor, y gestión de personas (`GET /users/managed` y `POST /users/:id/suspend`, `reactivate`, `deactivate`, `rank` y `manager`; audita `user.suspended`, `user.reactivated`, `user.deactivated`, `user.rank_changed` y `user.manager_changed`). `POST /users/:id/rank` responde **200 con cuerpo** (`removedRoles`, `assignedRole`, `templateSkipped`, `sharedAccounts` con tope de 100 y `sharedAccountCount`), acepta `reason` (obligatorio si sube la autoridad: `422 USER.RANK_REASON_REQUIRED`; opcional al bajar), rechaza el mismo rango, solo asigna la plantilla del nuevo rango si quien actúa tiene todos sus permisos (no escalamiento, ADR 0012; si no, `templateSkipped: true` y la persona queda sin rol), devuelve la lista de comparticiones solo si quien actúa tiene `vault.inventory.read` o `share.manage` (si no, lista vacía y solo el conteo; decidido en el caso de uso con `Authorizer.actorPermissions()`, que no audita) y protege al último Administrador activo (`409 USER.LAST_ADMINISTRATOR`, también en `suspend` y `deactivate`). Todo corre en una transacción con una sola auditoría `user.rank_changed` (`fromRank`, `toRank`, `reason`, `removedRoles`, `assignedRole`, `templateSkipped`, conteo de comparticiones) y escribe el evento `user.rank_changed` en el outbox en esa misma transacción; su manejador (`NotifyRankChanged`) envía el correo a la persona, con acuse por destinatario (ver [ADR 0035](adr/0035-outbox-event-publisher.md)). Es una operación con clave de reintento: repetirla dentro de 24 horas devuelve la misma respuesta guardada sin cambiar nada de nuevo                                                                                                                                                                                                                                                                                                                                                                                                  | `organization`                                                           |
| `provisioning`         | Alta de una organización por operaciones, con una conexión de administración: crea la organización, las plantillas de rol, la Raíz en estado invitada y su contraseña inicial en una sola transacción. Nunca se invoca desde una petición HTTP: lo ejecuta el comando de operaciones `pnpm --filter @iam/api provision` (variables `PROVISION_DATABASE_URL`, `ORG_NAME`, `ORG_SLUG`, `ROOT_EMAIL` y `ROOT_NAME`), que genera una contraseña inicial aleatoria, la imprime una sola vez y audita `organization.provisioned`. Genera además 8 códigos de emergencia de un solo uso para la Raíz (misma forma que los de recuperación), los imprime UNA vez junto a la contraseña inicial con la instrucción de imprimirlos y entregarlos a los dos custodios, y los guarda solo como hash con `kind = 'emergency'` | `access`, `identity`                                                     |
| `idempotency`          | Protección contra peticiones de creación repetidas: reserva de la clave, respuesta guardada 24 horas e interceptor que la aplica a los `POST` marcados (ver §7.2.1 y el [ADR 0029](adr/0029-idempotency-reservation-and-ownership.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `crypto`, `organization`                                                 |
| `notification`         | Puerto de correo saliente. Envía las invitaciones, el aviso a los Administradores por uso de un código de emergencia, el aviso de cambio de rango a la persona afectada (con el nombre de quien lo hizo, sin motivo, roles ni enlaces; sale por el outbox) y el aviso de seguridad a la propia persona (código de recuperación usado, llave de acceso agregada o quitada; sin enlaces y sin la dirección en el registro). Adaptadores: SMTP del dominio de la organización (ver §6.3.1), uno de desarrollo que escribe el enlace en el registro (se niega a arrancar en producción) y uno en memoria para las pruebas                                                                                                                                                                                                                                                                                                                                  | Ninguno                                                                  |

Endpoints y auditoría añadidos al cerrar la fase 1a (A5, A6 y A7):

| Endpoint                          | Regla                                                                                                                                                                                                                                                                                                                                                                                                         | Auditoría                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /me/sessions`                | Sesiones vivas de quien consulta: `id`, creación, última actividad, vencimiento, dispositivo, IP y marca `current`. Nunca devuelve tokens                                                                                                                                                                                                                                                                     | —                                                                                   |
| `POST /me/sessions/:id/revoke`    | `404` si la sesión no es suya o ya está cerrada; `422` si es la actual (para eso se usa el cierre de sesión)                                                                                                                                                                                                                                                                                                  | `auth.session_revoked`                                                              |
| `POST /users/:id/sessions/revoke` | Cierra todas las sesiones de una persona gestionada. Permiso `user.deactivate`, reglas de jerarquía, Raíz protegida; toma el bloqueo de jerarquía                                                                                                                                                                                                                                                             | `user.sessions_revoked`                                                             |
| `GET /roles`                      | Requiere `user.invite`                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                   |
| `POST /roles`                     | Cuerpo `{name, permissions}`. Permiso `role.manage`. Los permisos deben ser subconjunto de los del creador (`403 AUTHZ.ROLE_ESCALATION`); nombre repetido sin distinguir mayúsculas, `409 ROLE.NAME_TAKEN`. Usa idempotencia                                                                                                                                                                                  | `role.created`                                                                      |
| `PATCH /roles/:id`                | Cuerpo `{name, permissions}` (reemplazo completo). Permiso `role.manage`. El editor debe tener los permisos que el rol tiene hoy **y** los que quedarán, porque los titulares los reciben al instante (`403 AUTHZ.ROLE_ESCALATION`, con la negación auditada); plantillas del sistema `403 ROLE.SYSTEM_PROTECTED`; rol inexistente o archivado `404`; nombre repetido `409 ROLE.NAME_TAKEN`. Usa idempotencia | `role.updated` (solo conteos de permisos añadidos y quitados y si cambió el nombre) |
| `POST /roles/:id/archive`         | Permiso `role.manage`. Las plantillas del sistema no se archivan (`403 ROLE.SYSTEM_PROTECTED`). Un rol archivado deja de otorgar permisos y no sirve en invitaciones nuevas                                                                                                                                                                                                                                   | `role.archived`                                                                     |
| `GET /invitations`                | Invitaciones pendientes propias; la Raíz ve todas; marca las vencidas                                                                                                                                                                                                                                                                                                                                         | —                                                                                   |
| `POST /invitations/:id/resend`    | Solo quien la envió o la Raíz. Revoca el enlace anterior, genera token nuevo con 72 h y lo envía por correo. Si la inserción falla, el anterior no queda revocado (retroceso ante conflicto). Usa idempotencia                                                                                                                                                                                                | `user.invitation_resent`                                                            |

Una sesión cuenta como viva si no está revocada, no ha vencido y tuvo actividad en los últimos 30 minutos.

Endpoints y auditoría añadidos con A2 (passkeys) y A3 (códigos de emergencia). WebAuthn con verificación de usuario obligatoria y sin atestación; el identificador de la parte confiable y el origen salen de `APP_ORIGIN`.

| Endpoint                                                | Regla                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Auditoría                                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/passkey/options`                            | Tras la contraseña, entrega el desafío de ingreso. Desafío de 5 minutos, de un solo uso y ligado a la persona y al propósito. Pedirlo no cuenta como intento fallido. La respuesta del ingreso indica si la persona tiene passkeys                                                                                                                                                                                                                                                                                   | —                                                                                                                                                              |
| `POST /auth/passkey/verify`                             | Verifica la firma; el contador de firmas debe avanzar. Los fallos comparten el límite de intentos de la persona                                                                                                                                                                                                                                                                                                                                                                                                      | `auth.passkey_login`                                                                                                                                           |
| `GET /me/passkeys`                                      | Passkeys de quien consulta. Nunca devuelve claves                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                              |
| `POST /me/passkeys/registration/options`                | Sesión completa y reautenticación reciente. Máximo 10 por persona                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                              |
| `POST /me/passkeys/registration/verify`                 | Cuerpo con el nombre de la passkey. Sesión completa y reautenticación reciente                                                                                                                                                                                                                                                                                                                                                                                                                                       | `auth.passkey_registered`                                                                                                                                      |
| `POST /me/passkeys/:id/revoke`                          | Sesión completa y reautenticación reciente                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `auth.passkey_revoked`                                                                                                                                         |
| Paso de recuperación del ingreso (código de emergencia) | Solo después de la contraseña. Restablece el segundo factor de la Raíz (TOTP y códigos de recuperación ordinarios revocados), la deja en estado invitada con el registro del segundo factor pendiente (incluida la sesión que lo usó), cierra sus demás sesiones y envía el aviso por correo a cada Administrador activo después del _commit_. Los códigos de emergencia sin usar siguen vigentes; registrar un segundo factor nuevo reemite solo los códigos de recuperación ordinarios. No sustituye la contraseña | `auth.emergency_code_used` (crítico; con el número de destinatarios del aviso) y `auth.emergency_alert_incomplete` (si el correo falla o no hay destinatarios) |

Decisión del dueño (2026-10-27): solo quienes custodian los códigos pueden restablecer la Raíz; ningún Administrador puede hacerlo, solo recibe la alerta. Limitación: olvidar la contraseña Y perder los factores no tiene recuperación en el sistema; falta un procedimiento de operaciones.

**Módulo `vault` (fase 1b, porción B1a: cuentas).** Cada acción pide dos llaves: el permiso del catálogo y el nivel efectivo sobre esa cuenta (vista `effective_access`, calculada en SQL; ADR 0010 y 0036). El rango nunca concede acceso a una cuenta. Sin acceso se responde `NOT_FOUND`, igual que si no existiera; con nivel insuficiente, `AUTHZ.SHARE` (403) y la negación se audita con el id de la cuenta. Editar y archivar bloquean primero la fila de la cuenta y después leen el nivel, para no decidir con un nivel vencido mientras se espera el bloqueo.

**Credenciales (K1a): negaciones y concurrencia.** En crear, cambiar la contraseña, historial, copiar el usuario y revelar, tanto la falta de nivel (`AUTHZ.SHARE`, 403) como la falta de acceso a la cuenta (`NOT_FOUND`, 404) dejan una negación `authz.denied` con el id de la cuenta, en la transacción independiente del motor (ADR 0022) y sin secretos; no hay acciones de auditoría nuevas ni metadatos nuevos. Historial y copiar el usuario no tienen permiso propio en el catálogo: así lo define `docs/business/vault.md` ("Ninguno adicional"), por lo que basta con ser miembro activo y el nivel (EDIT y USE). Cambiar la contraseña bloquea la fila de la credencial (`select ... for update`) antes de leer la versión vigente: dos cambios concurrentes se serializan, y la restricción única `(organización, credencial, campo, versión)` más el índice parcial de "una sola vigente" son la segunda barrera. Las negaciones por falta de acceso en cuentas y comparticiones siguen sin auditarse (decisión abierta en `odd/tasks/phase-1b-vault.md`).

**Restaurar una versión de la contraseña (M2, BO-7; pruebas escritas sin ejecutar).** `POST /credentials/:id/versions/:version/restore`, sin cuerpo, sesión completa, `Cache-Control: no-store`, responde `201` con los metadatos de la credencial (nunca contenido). Exige el permiso propio `credential.restore_version` (D5; techo de rango 3, como `credential.update`) y nivel EDIT sobre la cuenta. Tener `credential.update` ya no basta: lo pidió el dueño y lo recomendó por unanimidad el panel de dos jueces, para poder conceder o retirar la restauración por separado de cambiar la contraseña. La decide el motor de autorización (`authorizer.require` en `ManageCredentials.restoreVersion`), no la guarda del controlador, que solo valida el borde. Sin el permiso: `AUTHZ.PERMISSION` (403) antes de tocar nada; las negaciones por nivel (`AUTHZ.SHARE`, 403) o por falta de acceso (`NOT_FOUND`, 404) se siguen auditando como `authz.denied`; todas las negaciones llevan `credential.restore_version` como permiso en los metadatos. El catálogo vive en `@iam/contracts` (`PERMISSIONS`), `PERMISSION_CEILING` y las etiquetas de `roles.json` (es-MX y en-US); el permiso no tiene obligaciones adicionales (`ACTION_POLICY`: sin reautenticación ni motivo, igual que cambiar la contraseña, porque restaurar no revela nada). Las plantillas `SYSTEM_ROLES` lo incluyen por techo (Raíz, Administrador, Líder y Operador; `SYSTEM_ROLES_VERSION = 3`) y la migración `0021` lo concede a los roles de sistema vivos que ya tenían `credential.update` (ver `docs/database.md`); **los roles personalizados con `credential.update` no lo reciben solos**: hay que agregarlo desde la pantalla de roles. Restaurar **no edita ni borra** ninguna versión: bloquea la fila de la credencial (`select ... for update`, serializa con cambiar la contraseña y con otras restauraciones), descifra la versión elegida con el módulo de criptografía antes de retirar la vigente (si falla, no se escribió nada) y la cifra como versión nueva `vigente + 1`, que pasa a ser la vigente; recalcula la huella y la fecha de rotación. El texto en claro vive solo dentro de esa transacción: no se devuelve, no se audita y no se registra. Auditoría atómica en la misma transacción: `credential.version_restored` con metadatos `restoredVersion` y `newVersion` (lista blanca en `audit-actions.ts`, solo números). Una versión inexistente, de otra credencial o de otra organización responde `NOT_FOUND` sin distinguirlas; restaurar la versión que ya es la vigente responde `409 CREDENTIAL.VERSION_ALREADY_CURRENT` sin crear versión. El número de versión de la ruta se valida en el borde (entero decimal positivo, `422` si no). Alcance: **solo la contraseña**, que es el único campo con historial expuesto; el usuario y el segundo factor no se restauran (el segundo factor tiene su propio ciclo de vida y retención, ver `manage-totp`).

**Límite de intentos al confirmar el segundo factor (T5, B4; bloqueo escalonado por tiempo en T5b; pruebas escritas sin ejecutar).** `POST /credentials/:id/totp/confirm` cuenta los fallos consecutivos por registro pendiente, con llave `<id de la credencial>:<versión del secreto>`: un re-registro sube la versión y abre un registro nuevo con todo en cero. El estado por registro (fallos, nivel de escalamiento y fin del bloqueo) vive en memoria del proceso (`InMemoryTotpConfirmAttemptStore`, puerto `TotpConfirmAttemptStore` con `state`, `save` y `clear`; una sola instancia y un reinicio lo pone en cero hasta que haya Redis). La política es pura y vive en `vault/domain/totp-confirm-lock.ts`: tras `TOTP_CONFIRM_MAX_FAILURES` (10, `@iam/contracts`) fallos consecutivos se impone un bloqueo de duración escalonada según `TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL` (5, 15 y 60 minutos; del tercero en adelante se repite el último), el contador de fallos vuelve a cero y el nivel se conserva al expirar el bloqueo. El reloj es el `Clock` inyectado, así que las pruebas avanzan el tiempo sin esperar. El caso de uso (`ManageTotp.confirm`) revisa el bloqueo DESPUÉS de bloquear la fila de la credencial y de comprobar el nivel EDIT y el estado `pending`, y ANTES de comparar el código: con el bloqueo vigente responde `429 CREDENTIAL.TOTP_CONFIRM_LOCKED` aunque el código sea el correcto (no hay oráculo), no cuenta el intento como fallo y audita la negación con `authz.denied` (`reasonCode` = el código, metadatos de la lista blanca, ya agrupada por ventana como las demás negaciones). Un acierto fuera del bloqueo limpia cuenta y escalamiento; un acierto durante el bloqueo no existe porque no se compara. Cada fallo sigue auditándose como `credential.totp_confirmed` con `outcome = failure` y `CREDENTIAL.TOTP_CODE_INVALID`; la respuesta es idéntica para cualquier código incorrecto, también el casi correcto. La respuesta 429 NO lleva `Retry-After`: el filtro de Problem Details solo lo emite para `RATE_LIMITED` y `CREDENTIAL.TOTP_CODE_LIMIT` tampoco lo lleva, así que no se inventó un patrón nuevo. Sin migración ni cambios a la auditoría. Se eligió 429 y no 423 porque `problem-status.ts` no usa 423 en ningún código. Limitaciones: la cuenta es por registro, no por persona; no sobrevive a un reinicio de la API; el almacén descarta las llaves menos recientes al pasar de 10 000 registros (lo que liberaría un bloqueo); el desbloqueo anticipado por un superior llegará en un paso siguiente.

| Endpoint                     | Permiso y nivel                                                                                         | Auditoría                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /platforms`             | Persona activa                                                                                          | —                                                              |
| `GET /accounts`              | Persona activa; solo cuentas con acceso efectivo                                                        | —                                                              |
| `GET /accounts/inventory`    | `vault.inventory.read`; solo metadatos, no concede acceso                                               | —                                                              |
| `GET /accounts/:id`          | Cualquier nivel                                                                                         | —                                                              |
| `POST /accounts`             | `account.create`; quien crea recibe MANAGE directo en la misma transacción                              | `account.created`                                              |
| `PATCH /accounts/:id`        | `account.update` y EDIT                                                                                 | `account.updated` (solo nombres de campos)                     |
| `POST /credentials/import/preview`, `POST /credentials/import` | `account.create` y `credential.create`; quien importa recibe MANAGE en cada cuenta nueva | `credential.imported` (solo conteos) |
| `POST /accounts/:id/archive` | `account.archive` y MANAGE; revoca todas las comparticiones vivas (las filas se conservan con su fecha) | `account.archived` (con el número de comparticiones revocadas) |


**Importación por CSV (O2a, B7 del plan; backend, pruebas escritas sin ejecutar).** Dos pasos sobre el mismo cuerpo `{ "csv": "<texto>" }` (sesión completa, `Cache-Control: no-store`, sin `@Idempotent()` porque el cuerpo lleva contraseñas): `POST /credentials/import/preview` (200, no escribe nada) y `POST /credentials/import` (201, escribe). Caso de uso `ImportCredentials` (módulo `vault`); el CSV se lee en `domain/credential-csv.ts` (RFC 4180: comillas, `""`, saltos dentro de comillas, `\r\n`/`\n`/`\r`, BOM, filas vacías descartadas; separador coma).

- **Autorización**: el motor de `access` exige `account.create` **y** `credential.create` (importar crea cuentas y credenciales nuevas; no existe un permiso "MANAGE" del catálogo, MANAGE es un nivel de compartición). Vale igual para previsualizar. Una negación se audita como `authz.denied` (transacción independiente, ADR 0022) y el contenido del archivo ni se lee. Quien importa recibe MANAGE sobre cada cuenta nueva (BO-4).
- **Reglas del archivo**: columnas `platform`, `account_name`, `credential_label`, `username`, `password` (la cabecera se compara sin distinguir mayúsculas ni orden) y `url` y `notes` opcionales; máximo 500 filas de datos y 1 000 000 bytes UTF-8. Un error de todo el archivo responde 422 con `CREDENTIAL_IMPORT.FILE_TOO_LARGE | TOO_MANY_ROWS | EMPTY | MALFORMED | HEADER_INVALID`. `url` y `notes` se aceptan pero **no se guardan** (la bóveda no tiene dónde ponerlas; decisión pendiente). El límite real de la petición es el cuerpo JSON de Fastify (≈1 MiB por omisión): un archivo con muchas comillas o saltos de línea crece al escaparse y puede recibir un 413 genérico antes de llegar a `FILE_TOO_LARGE`. Abierto: fijar `bodyLimit` para esta ruta o recibir el archivo como `text/csv`. Tampoco hay índice único de cuentas, así que dos importaciones simultáneas del mismo archivo pueden duplicar cuentas.
- **Filas**: `platform` debe coincidir (sin distinguir mayúsculas) con el nombre o el `slug` de una plataforma existente; texto que coincide con dos plataformas distintas es `PLATFORM_AMBIGUOUS`. Nombre, etiqueta y usuario se recortan y siguen los mismos largos y la misma regla de caracteres de control que los formularios; la contraseña se conserva tal cual (1 a 1024). Códigos por fila: `COLUMN_COUNT_MISMATCH`, `PLATFORM_REQUIRED|UNKNOWN|AMBIGUOUS`, `ACCOUNT_NAME_REQUIRED|INVALID`, `CREDENTIAL_LABEL_REQUIRED|INVALID`, `USERNAME_REQUIRED|INVALID`, `PASSWORD_REQUIRED|INVALID`.
- **Duplicados** (estado `duplicate`, no es error y se omiten al confirmar): la misma plataforma, cuenta y etiqueta repetida en el archivo (`in_file`), o una cuenta con la misma plataforma y nombre que la persona ya ve (`existing`, se omiten todas sus filas; solo cuentas con acceso efectivo, para no revelar cuentas ajenas). Filas válidas de una misma cuenta nueva comparten una sola cuenta con varias credenciales.
- **Previsualización**: por fila devuelve línea, estado, códigos, motivo de duplicado, plataforma, nombre de cuenta y etiqueta (acotados a 200 caracteres; en filas con número de celdas distinto al de la cabecera, vacíos). **Nunca** devuelve usuario ni contraseña.
- **Confirmación**: todo o nada. Con una fila inválida no se escribe nada y se responde 422 `VALIDATION.FAILED` con `errors: [{ field: "line.<n>", code: "<código de fila>" }]`. Si todo es válido se crean cuentas y credenciales en una sola transacción de la organización y se responde `{ accountsCreated, credentialsCreated, duplicatesSkipped }`. El cifrado reutiliza el mismo camino que crear una credencial (`store-credential-secret.ts`, extraído de `ManageCredentials`): solo el módulo de criptografía cifra.
- **Auditoría**: un único evento `credential.imported` por importación, con `accountsCreated`, `credentialsCreated` y `duplicatesSkipped` (lista blanca en `audit-actions.ts`), y es lo último que escribe la transacción (ADR 0023). No se escribe `account.created` ni `credential.created` por fila: auditar cada una retendría el bloqueo de la cadena durante el cifrado de hasta 500 filas; quién creó cada cuenta queda en `created_by`. Un rechazo por filas inválidas no escribe auditoría.
- **Secretos y registros**: el CSV vive solo en memoria, no se guarda ni se registra (la API no registra cuerpos de petición; hay prueba de canarios en los registros). Sin migración.
- **Pendiente**: concurrencia (dos importaciones simultáneas del mismo archivo pueden duplicar cuentas: no hay restricción única por nombre) y pantalla (O2b).

Los listados usan paginación por cursor ordenada por nombre en minúsculas e id (índice de la migración 0016); un cursor alterado devuelve la primera página.

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
- Patrón _expandir y contraer_: primero se agrega, luego se retira lo viejo en otra migración.
- Dos roles: **aplicación** (sin saltarse RLS, no dueño de tablas; en la tabla de auditoría solo puede insertar y leer) y **migraciones**.
- Bajas lógicas; nada del dominio se borra físicamente salvo datos efímeros con TTL.
- Concurrencia optimista: cada agregado editable lleva un número de versión y las modificaciones por HTTP envían la versión esperada.

### 6.2 Transacciones y RLS

- La unidad de trabajo abre la transacción, fija el contexto de organización solo para esa transacción y publica la transacción actual en un almacenamiento local asíncrono; los repositorios la toman de ahí. **No hay acceso a la base de datos fuera de una transacción con contexto.**
- La organización sale del contexto de petición (sesión autenticada), nunca de un parámetro que envía el cliente.
- Una prueba de integración con **dos organizaciones** verifica, por repositorio, que A nunca lee, modifica ni cuenta filas de B. Corre en cada PR.

### 6.3 Otros adaptadores

- **KMS**: puerto de gestión de claves con adaptadores AWS y local. El local **se niega a arrancar** si el entorno es producción. En pruebas, un adaptador falso determinista.
- **Sonda de arranque del KMS**: con el adaptador AWS, el punto de entrada de la API (`main.http.ts`) ejecuta `verifyKeyManagementAccess` (`app/key-management.ts`) antes de montar el contenedor: genera una DEK desechable con el contexto de cifrado `startup-probe` y la abre de vuelta. Si falla, la API **no arranca** (registra un error fatal genérico y sale; el detalle de AWS no se registra). Exige que la identidad de la API pueda ejecutar `kms:GenerateDataKey` y `kms:Decrypt` sobre la clave, que la clave esté habilitada y que la región sea la correcta; si la política de la clave restringe el contexto `organization_id`, debe permitir también `startup-probe` ([ADR 0020](adr/0020-reference-cloud-aws.md)). El adaptador local no tiene nada que verificar y el recifrado (`reencrypt`) no ejecuta la sonda. Sigue sin probarse contra AWS real.
- **Redis**: contadores, límites y colas. **Nunca** material criptográfico.
- **Correo y SMS**: detrás de puertos; el proveedor concreto es intercambiable.
- **Outbox**: el worker publica y marca la fecha de publicación; reintentos con _backoff_.

#### 6.3.1 Correo saliente (SMTP)

El correo de invitación sale por el servidor SMTP del dominio propio de la organización (decisión del dueño, 2026-10-27: no Gmail ni Outlook). Se configura con variables de entorno, validadas al arrancar:

| Variable                     | Valor                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `MAIL_TRANSPORT`             | `log` (desarrollo) o `smtp` (real). Producción EXIGE `smtp`                                         |
| `SMTP_HOST`                  | Servidor SMTP del dominio                                                                           |
| `SMTP_PORT`                  | 587 por defecto                                                                                     |
| `SMTP_SECURITY`              | `starttls` (por defecto), `tls` o `none`. `none` se rechaza en producción                           |
| `SMTP_USER`, `SMTP_PASSWORD` | Se definen juntas                                                                                   |
| `MAIL_FROM`                  | Remitente del dominio propio, p. ej. `IAM <no-reply@sudominio>`                                     |
| `APP_ORIGIN`                 | Origen de la aplicación; de él salen el identificador de la parte confiable y el origen de WebAuthn |
| `WEBAUTHN_RP_NAME`           | Opcional; nombre que ve la persona al registrar una passkey. Por defecto `IAM`                      |

Reglas del adaptador SMTP: STARTTLS obligatorio, certificado verificado, TLS 1.2 como mínimo y tiempos límite. Los errores del proveedor se sustituyen por uno genérico (pueden citar destinatario o contenido) y los errores de configuración nunca repiten valores. El correo se redacta en es-MX o en-US según la persona destinataria; el enlace lleva el token en el fragmento (`#token=`) y el vencimiento se indica en UTC. Probado contra un servidor SMTP de pruebas real en un contenedor. Para la entregabilidad, el dominio necesita registros SPF, DKIM y DMARC en el DNS (fuera del sistema).

#### 6.3.2 Resto de las variables de entorno de la API

Fuente de verdad: `apps/api/src/app/config.ts` (no existe `.env.example`). Las de correo, `APP_ORIGIN` y `WEBAUTHN_RP_NAME` están en §6.3.1.

| Variable                  | Valor por defecto    | Para qué                                                                                                                                                                                                                                                                        |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | `development`        | `development`, `test` o `production`. En producción se exige `MAIL_TRANSPORT=smtp` y `KMS_ADAPTER=aws`: el adaptador de claves local se niega a arrancar                                                                                                                        |
| `HOST` y `PORT`           | `127.0.0.1` y `3000` | Dirección y puerto de escucha                                                                                                                                                                                                                                                   |
| `LOG_LEVEL`               | `info`               | Nivel de `pino`                                                                                                                                                                                                                                                                 |
| `DATABASE_URL`            | Ninguno              | Conexión del rol de aplicación. Obligatoria para arrancar la API                                                                                                                                                                                                                |
| `DB_POOL_MAX`             | `10`                 | Tamaño del pool de conexiones (1 a 100)                                                                                                                                                                                                                                         |
| `LOCAL_KMS_KEY_FILE`      | `.local-kms/kek.key` | Archivo de la clave del adaptador de desarrollo; no sirve en producción                                                                                                                                                                                                         |
| `WEB_DIST_DIR`            | Ninguno              | Carpeta de la SPA compilada; si se omite, la API no sirve el frontend                                                                                                                                                                                                           |
| `KMS_ADAPTER`             | `local`              | Adaptador de gestión de claves: `local` (desarrollo) o `aws` (AWS KMS, [ADR 0020](adr/0020-reference-cloud-aws.md)). Con `NODE_ENV=production` solo se acepta `aws`; otro valor hace fallar la configuración al arrancar con un error sobre esta clave                          |
| `AWS_KMS_KEY_ID`          | Ninguno              | Id, ARN o alias de la clave simétrica de AWS KMS. Obligatoria con `KMS_ADAPTER=aws`                                                                                                                                                                                             |
| `AWS_REGION`              | Ninguno              | Región de esa clave. Obligatoria con `KMS_ADAPTER=aws`. Las credenciales de AWS las lee el SDK (variables estándar o rol IAM), no la aplicación                                                                                                                                 |
| `OUTBOX_WORKER_ENABLED`   | `false`              | `true` o `false` (se compara el texto). Activa el publicador del outbox dentro de la API ([ADR 0035](adr/0035-transactional-outbox-for-events.md)). Apagado salvo orden expresa; mientras no haya manejadores registrados, los eventos pendientes esperan (sin contar intentos) |
| `OUTBOX_POLL_INTERVAL_MS` | `5000`               | Pausa entre pasadas del publicador, de 500 a 60000                                                                                                                                                                                                                              |
| `TRUST_PROXY`             | `false`              | Solo detrás de un balanceador de confianza: toma la IP del cliente de `X-Forwarded-For`. Acepta `false`, `true`, un número de saltos o una lista de IP y rangos CIDR. Léelo completo en [§6.4](#64-trust_proxy-qué-proxies-son-de-confianza)                                    |

### 6.4 `TRUST_PROXY`: qué proxies son de confianza

`TRUST_PROXY` acepta cuatro formas. Cualquier otro valor hace que la API **no arranque** (el error nombra la clave, nunca el valor):

| Valor                                                                    | Significado                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `false` (por defecto)                                                    | No se confía en ningún proxy: la IP es la del par que se conecta                                                                                                      |
| Un número del 1 al 10                                                    | Se confía en los últimos N saltos. `1` es un solo balanceador delante. **No valida al par directo**: quien llegue a la API sin pasar por el proxy puede falsear su IP |
| Lista separada por comas de IP y rangos CIDR (`10.0.0.5,192.168.0.0/16`) | Solo se toma la cabecera si el par directo está en la lista, y se recorre la cadena hasta la primera dirección que no lo está                                         |
| `true`                                                                   | Se confía en **toda** la cadena de `X-Forwarded-For`. Es la opción más peligrosa: úsala solo si el balanceador sobrescribe la cabecera                                |

No se aceptan rangos demasiado amplios (prefijo menor a `/8` en IPv4 o a `/16` en IPv6, ni `::ffff:` con prefijo menor a `/104`), cero saltos ni nombres de máquina. Tampoco se aceptan `TRUE`, `yes` ni un valor vacío: la API no arranca. Ojo: `1` ya no significa «sí», sino un salto. Con `true` se mantienen los dos efectos opuestos de antes, y ambos son un riesgo:

- **Sin activarlo detrás de un balanceador**: todas las peticiones llegan con la IP del balanceador. El límite de 60 peticiones por minuto por IP se comparte entre todas las personas y un solo cliente ruidoso bloquea a los demás.
- **Activado sin que el balanceador sobrescriba la cabecera**: quien llama puede enviar su propio `X-Forwarded-For` y la API lo toma como su IP. Cada petición con una IP distinta evita el límite por IP (los contadores por correo y por usuario del segundo factor no dependen de la IP y siguen aplicando).

Para activarlo con seguridad, prefiere la **lista de IP o CIDR** del balanceador: una petición que llega de un origen fuera de la lista no puede falsear su dirección con la cabecera. El número de saltos solo es seguro si la API es inalcanzable sin pasar por el proxy. En ambos casos, si el puerto se puede alcanzar directo, déjalo en `false`.

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
3. Guard de permisos. _Pendiente: en la fase 1a la autorización la hace el caso de uso con el motor._
4. Idempotencia (respuesta guardada 24 h) para las peticiones que crean recursos. **Implementada** (A7), ver §7.2.1.

Orden efectivo en la fase 1a: límite por dirección de red, protección CSRF, guard de sesión y un interceptor que fija el contexto de la petición (ver §3.7). 5. Filtro global de excepciones: traduce los errores de dominio y los errores conocidos a **detalles de problema (RFC 9457)**; cualquier otra excepción responde un `500` genérico con el identificador de petición, sin detalles internos.

#### 7.2.1 Idempotencia

- Las peticiones `POST` que crean recursos exigen la cabecera `Idempotency-Key` (8 a 200 caracteres: letras, dígitos y `. _ : -`). Hoy se aplica a `POST /invitations`, `POST /invitations/:id/resend`, `POST /roles` y `PATCH /roles/:id`. `POST /users/:id/rank` deliberadamente NO la usa: una respuesta guardada 24 horas se reproduciría sin volver a autorizar y devolvería el detalle de comparticiones a quien ya perdió el permiso; una repetición recibe `USER.INVALID_STATE` (mismo rango) y el detalle queda en la auditoría. El cliente web ya la envía.
- La respuesta se guarda 24 horas por organización, actor y clave (tabla `idempotency_keys`). Un reintento con la misma clave y la misma petición devuelve la misma respuesta con la cabecera `Idempotent-Replayed: true` y sin crear nada de nuevo.
- Errores: misma clave con otra petición, `422 IDEMPOTENCY.KEY_REUSED`; clave ausente o inválida, `422 IDEMPOTENCY.KEY_REQUIRED`; petición original aún en curso, `409 IDEMPOTENCY.IN_PROGRESS`.
- La reserva dura 1 minuto, para que una petición caída no bloquee la clave durante un día. La toma de una reserva vencida es atómica y una petición original lenta no puede sobrescribir a un dueño más reciente. Si guardar la respuesta falla después del _commit_, la clave no se libera.
- Las respuestas de error no se guardan: el reintento se ejecuta de nuevo.
- **Nunca** se usa en endpoints cuya respuesta lleve secretos, porque la respuesta se guarda tal cual.
- Limitaciones conocidas: las filas vencidas se purgan con el comando `purge-expired` (falta programarlo en el despliegue) y el reintento no vuelve a comprobar permisos durante las 24 horas.

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
  - **Listados de orden fijo** (`GET /me/sessions`, `/me/passkeys`, `/roles`, `/invitations`): solo aceptan `cursor` y `limit` (10, 25, 50 o 100; otro valor responde `422`). Paginan por clave compuesta (orden, identificador) y piden `limit + 1` filas para saber si hay página siguiente. Su cursor es el arreglo de la clave de orden de la última fila en base64url, **sin firma**: solo mueve la ventana y no da acceso a nada, porque la persona, la organización o la jerarquía las fija siempre la consulta. Cada parte se valida antes de llegar a SQL y un cursor ilegible o manipulado devuelve la primera página, nunca un error. Las marcas de tiempo viajan como texto para no perder microsegundos. Las sesiones se ordenan por `created_at` (inmutable) y no por `last_seen_at`, que el servidor reescribe en cada petición y haría saltar filas entre páginas. El ayudante común es `shared/kernel/keyset-page.ts`.
- El orden solo se admite por campos indexados y de lista blanca; un campo no permitido responde `422`.
- Fechas ISO 8601 UTC. El identificador de petición va en cada respuesta.
- Eventos en tiempo real por SSE (`/api/v1/events`).
- Contratos Zod en `packages/contracts` y OpenAPI generado de ellos. Un cambio incompatible crea `v2` del recurso afectado.

### 6.5 Publicador del outbox (worker)

Módulo `modules/outbox` ([ADR 0035](adr/0035-transactional-outbox-for-events.md)). Corre dentro del proceso de la API con `OUTBOX_WORKER_ENABLED=true`, arranca después de `listen` y se detiene primero en el apagado ordenado (espera a la pasada en curso antes de cerrar los pools). Se asume una sola instancia; `FOR UPDATE SKIP LOCKED` evita el doble procesamiento aunque hubiera dos.

- **Manejadores**: `container.outboxHandlers.register(type, handler)`, antes de arrancar. Deben ser idempotentes por `event.id` (la entrega es al menos una vez). Manejadores reales: aviso a la Raíz por superar el tope de revelaciones (`NotifyRevealLimitExceeded`, módulo `vault`; [ADR 0031](adr/0031-reveal-rate-limit-per-user.md)) y aviso de segundo factor sin confirmar (`NotifyPendingTotpUnconfirmed`, ver abajo). El caso de uso de revelado escribe el evento en la misma transacción que la negación y su auditoría, solo con ids y números; el manejador resuelve nombre y destinatario al enviar, usa el puerto `Mailer` existente (`sendRevealLimitAlert`, textos es-MX y en-US) y falla (para reintentar) si no hay Raíz activa o el correo no sale.
- **Aviso de segundo factor sin confirmar (N1a, S10/DF-6)**: un barrido (`EnqueuePendingTotpNotices`, módulo `vault`) corre dentro del sondeo, justo antes de cada pasada del trabajador y como máximo cada 5 minutos, con la misma activación `OUTBOX_WORKER_ENABLED` (no hay variable propia). Organización por organización (`TenantScope.runAs`, sin actor), reclama en lotes de 100 los registros de `credential_totp` con `status = 'pending'`, `pending_notice_at is null`, `registered_at` de 24 horas o más y credencial no archivada (`FOR UPDATE SKIP LOCKED`), les marca `pending_notice_at` y escribe un evento `credential.totp_pending_unconfirmed` en `outbox_events`, todo en la MISMA transacción: el aviso se encola una sola vez por registro pendiente (un re-registro limpia la marca y abre un plazo nuevo). El evento lleva solo `credentialId`, `registeredBy` y `registeredAt`. El manejador (`NotifyPendingTotpUnconfirmed`) vuelve a comprobar al enviar que el registro siga pendiente y sea el mismo (no se envía si se confirmó, se retiró o se re-registró entre tanto) y que quien lo registró siga activa; avisa SOLO a esa persona con `Mailer.sendPendingTotpNotice` (es-MX y en-US, nombre saneado con el helper compartido `sanitize-display-name`, sin nombres de cuenta ni de credencial, sin enlaces). Un fallo de envío lanza para reintentar. Sin migración nueva: la columna `pending_notice_at` y el índice parcial `credential_totp_org_pending` ya existen desde la 0018. El barrido no escribe auditoría (igual que la purga de efímeros; decisión abierta en `odd/tasks/phase-1b-worker.md`).
- **Aviso de seguridad a la dueña de la cuenta (G5)**: el restablecimiento con código de emergencia (`SecondFactor.consumeRecoveryCode`) revoca el segundo factor; si la persona tenía una aplicación autenticadora verificada, el caso de uso escribe en `outbox_events`, en la MISMA transacción que la revocación, un evento `user.security_notice` (`PgSecurityNoticeQueue`, módulo `identity`) con solo `userId`, `kind` (`totp_removed`) y `occurredAt`: si la transacción revierte, el evento también. Su manejador (`NotifySecurityNotice`) resuelve correo e idioma desde el directorio al enviar, usa el método existente `Mailer.sendSecurityNotice` (se amplió `SecurityNoticeKind` con `totp_removed`, sin método nuevo; textos es-MX y en-US, solo fecha y tipo, sin códigos, enlaces ni direcciones de red) y avisa SOLO a la dueña. Acuse por destinataria con `handler_key` = `identity.security-notice:<id de la persona>`. Se omite sin fallar si la persona ya no existe o está dada de baja; un fallo de envío lanza para reintentar; un contenido inválido es `SecurityNoticePayloadError` (`retryable = false`, cuarentena inmediata). No cambia la auditoría existente (`auth.emergency_code_used`). `OUTBOX_SECURITY_NOTICE_KINDS` lista los tipos que usan el outbox; los avisos de código de recuperación y llaves siguen saliendo después del _commit_ con mejor esfuerzo.
- **Idempotencia con efectos externos**: `OutboxDeliveryReceipts` (tabla `outbox_deliveries`) guarda un acuse por evento, manejador y, si el efecto tiene varias destinatarias, por destinataria (`handler_key` = `vault.reveal-limit-notice:<id de la Raíz>` o `vault.pending-totp-notice:<id de quien registró>` o `identity.security-notice:<id de la dueña de la cuenta>`). Se consulta antes de cada efecto y se anota tras cada uno exitoso, en una transacción independiente que sobrevive al rollback del trabajador; si falla una destinataria, el reintento solo reenvía a la pendiente. Un duplicado solo es posible si el proceso cae entre el envío y la anotación de esa destinataria; en avisos de seguridad se prefiere eso a perder la alerta. Los acuses se purgan junto con sus eventos publicados (D6, ver abajo).
- **Aislamiento**: cada evento se procesa en su propia transacción con `app.org_id` fijado a la organización del evento (`TenantScope.runAs`, como la purga). No se usa un rol con BYPASSRLS: así un manejador no puede leer otros inquilinos.
- **Fallos**: se revierte lo que escribió el manejador, se cuenta el intento y se reprograma con espera exponencial (30 s, doble en cada fallo, tope 1 h). Al octavo fallo el evento queda en cuarentena: `published_at is null and next_attempt_at = 'infinity'`. Un error que el manejador declara no reintentable (`retryable = false`, como el payload con forma inválida de los tres avisos) va a cuarentena en el primer fallo, sin gastar los reintentos (`isNonRetryableError`, `retry-policy.ts`). Cada manejador tiene un plazo de 45 s por evento; si vence cuenta como fallo (`OUTBOX.HANDLER_TIMEOUT`). La parada ordenada espera 60 s a la pasada en curso.
- **Plazos y correo duplicado**: el peor caso de un intento SMTP es 5 s de conexión + 5 s de saludo + 10 s de inactividad del socket = 20 s, menos de la mitad del plazo del manejador (45 s), que a su vez es menor que la espera de la parada (60 s). Así el plazo no vence con un correo ya aceptado por el servidor (lo que provocaba un duplicado al reintentar). La prueba `src/app/outbox-timeouts.test.ts` fija la relación entre las constantes. Sigue existiendo la ventana mínima entre el envío y el acuse si el proceso cae.
- **Retención de eventos publicados (D6; pruebas escritas sin ejecutar)**: el comando `purge-expired` (módulo `maintenance`, `PurgeExpiredEphemeral`, [ADR 0038](adr/0038-purge-expired-ephemeral-rows.md)) borra, organización por organización con `TenantScope.runAs` sin actor, los eventos de `outbox_events` con `published_at` no nulo y anterior a 7 días (`OUTBOX_RETENTION_DAYS`, constante hasta que exista la tabla de ajustes del sistema, donde pasará a vivir) y sus acuses de `outbox_deliveries`. `PgOutboxRetentionStore` elige un lote de hasta 1000 eventos (los más antiguos primero), borra primero sus acuses y luego los eventos en la misma transacción, repite mientras el lote venga lleno y no lee el contenido. Nunca borra los eventos sin publicar ni los de cuarentena. No escribe auditoría. Es idempotente. La migración `0022` concede `delete` sobre `outbox_deliveries` a `iam_app`. El resumen del comando suma `eventos del outbox borrados` y `acuses del outbox borrados`. Ver `odd/tasks/outbox-hardening.md`.
- **Tipo sin manejador**: espera. No cuenta intentos ni va a cuarentena; se reprograma al tope (1 h) y se avisa una vez por pasada y tipo (solo nombre y conteo). Así no se pierden eventos escritos antes de que exista su manejador.
- **Defensa en profundidad**: tras reclamar, se comprueba que el evento sea de la organización del ámbito; si no, no se procesa, se registran solo los ids y la organización cuenta como fallida.
- **Apagado**: la pasada se detiene entre eventos y entre organizaciones; `stop()` espera como máximo 35 s y, si se excede, lo registra y devuelve.
- **Cuarentena, SQL manual** (rol de administración):

  ```sql
  select id, organization_id, type, attempts, created_at
    from outbox_events where published_at is null and next_attempt_at = 'infinity';

  update outbox_events set next_attempt_at = now(), attempts = 0
   where published_at is null and next_attempt_at = 'infinity' and id = '<id del evento>';
  ```

- **Registro**: solo id del evento, tipo, organización, intento, resultado y código de fallo. Nunca el `payload` ni el mensaje del error.
- **Pendiente**: separar en `main.worker.ts`.

### 7.5 Respuestas con secretos

Solo la acción dedicada (revelar, código 2FA, exportar) devuelve un secreto, con la cabecera de no almacenamiento en caché. Nunca aparece en listados ni en detalles.

## 8. Buenas prácticas de NestJS

- **Puntos de entrada, una imagen**: `main.http.ts` (API), `main.migrate.ts` (migraciones) y `main.provision.ts` (alta de organizaciones por operaciones), con comandos de arranque distintos, todos en `apps/api/src`. El publicador del outbox corre dentro de la API (§6.5); su punto de entrada propio (`main.worker.ts`) sigue planeado.
- **Cabecera `Permissions-Policy`**: la API la emite en cada respuesta junto a la CSP (`PERMISSIONS_POLICY` en `app/create-app.ts`; Helmet no la genera). Solo permite `display-capture` al propio origen (alta de TOTP por captura de pestaña, ADR 0017) y niega cámara, micrófono, geolocalización, pagos, USB, serie y Bluetooth. Es configuración de cabeceras: ruta protegida.
- **Fastify** como adaptador. Los plugins de Fastify (cabeceras de seguridad, cookies) se registran en el punto de entrada de la API, no en módulos de dominio.
- **Módulos por funcionalidad**: un módulo de Nest por módulo de dominio; solo exporta lo que la fachada declara.
- **Inyección por constructor**, con símbolos para los puertos. Prohibida la inyección por propiedad y la obtención de dependencias "al vuelo" desde el módulo de referencia.
- **Sin referencias circulares**: el uso de referencias diferidas es señal de que dos módulos están mal separados; se resuelve con un evento o moviendo la responsabilidad.
- **Configuración**: variables de entorno validadas al arrancar con un esquema Zod propio; el servicio no arranca con configuración inválida. Los secretos de infraestructura vienen del gestor de secretos, nunca de archivos de entorno ni del repositorio.
- **Ciclo de vida**: cierre ordenado (drenar peticiones, cerrar pool y colas). Las comprobaciones de salud distinguen vida (_liveness_) y disponibilidad (_readiness_).
- **Workers**: los procesadores de BullMQ viven en la capa de interfaz del módulo, delegan en un caso de uso y son idempotentes, con reintentos y _backoff_ acotados.
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
- **Rate limiting** por usuario, IP y acción (`rate-limiter-flexible` sobre Redis); mensajes idénticos para usuario inexistente o contraseña incorrecta. _Estado en la fase 1a:_ el límite por IP (60 por minuto en las rutas de autenticación e invitación) y los contadores de intentos fallidos por correo y por usuario viven en la memoria de cada instancia; el adaptador de Redis está pendiente ([ADR 0026](adr/0026-atomic-failed-attempt-counting.md)). La plataforma opera con una sola instancia ([ADR 0039](adr/0039-single-instance-until-redis.md)) y la API lo hace cumplir al arrancar con un candado consultivo de PostgreSQL (`single-instance-lock.ts`).
- **Auditoría**: append-only, encadenada por hash; sin secretos, ni parciales; los metadatos pasan por una lista blanca de campos.
- El correo entrante (fase 4) y los datos externos son **entrada no confiable**: nunca se renderiza HTML, se ignoran adjuntos y hay límites de tamaño y tiempo.

## 11. Observabilidad y logs

- `pino` en JSON con identificador de petición, organización, actor, módulo y caso de uso, tomados del contexto de petición.
- Redacción por configuración de los campos de contraseña, secreto, token, TOTP, código, autorización, cookie, texto cifrado y clave de datos envuelta, y de los cuerpos de las rutas sensibles.
- Una prueba envía secretos conocidos por los endpoints sensibles y verifica que no aparecen en los logs capturados.
- Logs técnicos y auditoría son cosas distintas: los logs se muestrean; la auditoría es evidencia y nunca se pierde.
- OpenTelemetry: trazas y métricas de negocio y seguridad (revelaciones, códigos 2FA, llamadas al KMS, aciertos de caché de claves, negaciones por código).

## 12. Pruebas

| Tipo                   | Herramienta                                    | Qué cubre                                                                      |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Unitarias de dominio   | Vitest                                         | Políticas, entidades, objetos de valor. 90 % de ramas en módulos protegidos    |
| Matriz de autorización | Vitest, tabla generada                         | Cada actor × rango × relación × acción. 100 % de combinaciones                 |
| Mutación               | Stryker                                        | `access` y `crypto` (mínimo 80 %)                                              |
| Integración            | Vitest + Testcontainers                        | Repositorios, RLS, transacciones, auditoría, colas (PostgreSQL y Redis reales) |
| Aislamiento de tenants | Testcontainers                                 | Dos organizaciones; ningún cruce                                               |
| Contrato               | Zod + OpenAPI                                  | La API cumple su contrato                                                      |
| Arquitectura           | `eslint-plugin-boundaries`, dependency-cruiser | Regla de dependencia                                                           |
| Seguridad              | Semgrep, gitleaks, osv-scanner, Trivy          | SAST, secretos, dependencias, imágenes                                         |

- **Casos de uso**: se prueban con puertos falsos en memoria (sin Nest ni base de datos). Los repositorios se prueban con PostgreSQL real.
- **Controladores**: pruebas de integración HTTP con la inyección de peticiones de Fastify, contra una base de datos real.
- **Reloj e identificadores deterministas**: se usan versiones falsas de ambos.
- **Criptografía**: vectores conocidos (AES-GCM, RFC 6238 para TOTP) y pruebas negativas (datos asociados alterados, nonce reutilizado, clave incorrecta, texto truncado).
- **Auditoría**: cada caso de uso sensible verifica el evento exacto que escribe; prueba de falla cerrada; cadena de hashes verificada tras operaciones concurrentes.
- **Matriz de autorización**: la escribe o la revisa una persona como código de producción (ver sección 14).
- Las pruebas de integración usan contenedores efímeros; ningún dato real fuera de producción.
- Vitest se divide en dos proyectos: uno unitario, sin contenedores, y otro de integración, con un PostgreSQL 18 por ejecución y una base por archivo, migrada con el rol de migraciones y usada con el rol de aplicación. Los comandos exactos de ejecución, incluido el uso de Podman, están en el [`README.md`](../README.md) raíz.
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

| Agente               | Úsalo para                                                                                            | Límites                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `general-purpose`    | Implementar un caso de uso, repositorio o controlador con sus pruebas, cuando el alcance está acotado | Escribe código; necesita rutas permitidas explícitas |
| `typescript-pro`     | Tipos de marca, tipos genéricos del resultado, tipos derivados de `contracts`, utilidades tipadas     | Solo tipos y utilidades; no decide arquitectura      |
| `Explore`            | Mapear dónde vive algo o cómo fluye una petición, sin tocar nada                                      | Solo lectura                                         |
| `Plan`               | Diseñar la implementación de una funcionalidad antes de escribirla                                    | No escribe archivos                                  |
| `review-risk`        | Revisar seguridad, permisos, exposición de datos y dependencias                                       | Revisión; no corrige                                 |
| `review-resilience`  | Revisar reintentos, fallas parciales, transacciones, concurrencia                                     | Revisión; no corrige                                 |
| `review-reliability` | Revisar valor y determinismo de las pruebas, bordes y regresiones                                     | Revisión; no corrige                                 |
| `review-readability` | Revisar nombres, complejidad y tamaño del cambio                                                      | Revisión; no corrige                                 |
| `git`                | Commits granulares con Conventional Commits                                                           | Pide confirmar el alcance antes de preparar archivos |

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

- [x] **Passkeys (WebAuthn)** (A2): hechas, opcionales para todos y varias por persona; tabla `webauthn_challenges` (migración 0011, [ADR 0028](adr/0028-passkeys-optional-enforcement-later.md) y [ADR 0030](adr/0030-session-bound-webauthn-challenges.md)). Revisadas por dos jueces ciegos (hallazgos corregidos); la purga de desafíos vencidos la hace `purge-expired`. La reautenticación sigue aceptando solo el código de la aplicación autenticadora. Exigirlas a la Raíz y a los Administradores queda como futura configuración de la organización (aún no hay pantalla de configuración).
- [x] **Cambio obligatorio de la contraseña inicial de la Raíz** (A4): hecho.
- [x] **Códigos de emergencia de la Raíz** (A3): hechos (migración 0010, columna `kind`; [ADR 0027](adr/0027-emergency-codes-root-reset-model.md)). Decisión del dueño: solo los custodios pueden restablecer la Raíz; ningún Administrador. Quien olvida la contraseña Y pierde los factores se recupera con el comando `recover-root` (control dual de dos custodios, [ADR 0037](adr/0037-root-recovery-dual-custody.md)), que además emite códigos de emergencia nuevos.
- [ ] **Redis para los límites de intentos y por IP**: hoy son por instancia y en memoria. Sin Redis, el sistema debe operar con una sola instancia (ver el [runbook](runbooks/single-instance-operation.md)). No entró en la entrega de correo; el dueño solo respondió sobre el correo.
- [x] **Trabajo de limpieza de datos temporales** (G1): hecho como comando `purge-expired` ([ADR 0038](adr/0038-purge-expired-ephemeral-rows.md)), que recorre las organizaciones por el camino de `docs/database.md` §7.5. Falta programar su ejecución periódica en el despliegue. Desde H1b el mismo comando destruye también las versiones del secreto del segundo factor (`credential_secrets`, `field = 'totp_uri'`) reemplazadas por un re-registro hace más de 30 días (nunca la vigente ni otros campos; sin migración ni auditoría, ver el ADR 0038).
- [x] **Adaptador de KMS de proveedor** (L1): `AwsKeyManagement` (AWS KMS, [ADR 0020](adr/0020-reference-cloud-aws.md)). Sin probar contra AWS real; la API de HTTP comprueba el acceso al KMS al arrancar (ver §6, sonda de arranque).
- [x] **Sincronización de roles de sistema** (B5a): comando de mantenimiento `sync-system-roles` (`apps/api/src/main.sync-system-roles.ts`, módulo `maintenance`), hermano de `purge-expired`. Recorre las organizaciones con una transacción por organización bajo el rol `iam_app` y el aislamiento por filas normal, y alinea los permisos de los roles de sistema vivos con la plantilla del mismo nombre de `SYSTEM_ROLES` (comparación como conjuntos; sube `version`). Nunca toca roles personalizados ni roles de sistema sin plantilla. Cada rol modificado escribe la auditoría `role.system_synced` (sin actor, con `roleName`, `removed` y `added` como nombres de permisos separados por coma) en la misma transacción; si no se puede auditar, esa organización se revierte. Es idempotente y debe correrse una vez por despliegue que cambie las plantillas ([runbook](runbooks/provision-organization.md)). Imprime solo conteos y sale con código 1 si alguna organización falló.
- [ ] **Worker**: no hay punto de entrada de worker (`apps/api/src` tiene API, migraciones, alta de organizaciones, recuperación de la Raíz, purga y recifrado).
- [x] **Correo real** (A8, parte de correo): adaptador SMTP del dominio propio (§6.3.1). Avisos a la persona (G5, parcial): código de recuperación usado y llave de acceso agregada o quitada; salen después del _commit_, con tope de 5 s y de mejor esfuerzo, y su fallo se audita como `auth.security_notice_failed` (solo el tipo). Baja de la aplicación autenticadora (G5, decisión del panel de dos jueces): sale por el outbox, no después del _commit_; ver §6.5. Siguen sin existir dispositivo nuevo y regeneración de códigos porque no hay un flujo que los origine (`odd/tasks/security-notices.md`).
- [ ] **CI en GitHub y escáneres** (A9): despriorizada por el dueño (2026-10-27), no bloqueada; el repositorio ya tiene remoto y el flujo de `.github/workflows/ci.yml` nunca se ha ejecutado allí.
- [x] **Idempotencia** de las peticiones que crean recursos (§7.2.1, A7): hecha. Limitaciones: la purga de filas vencidas (`purge-expired`) falta programarla y no hay nueva comprobación de permisos en el reintento.
- [ ] **Guard de permisos** como primera barrera (§7.2).
- [x] **Comando de operaciones** para dar de alta una organización y registrar el alta en la auditoría (A3), ahora también con los códigos de emergencia.
- [x] **Gestión de personas** (A1) y **gestión de sesiones propias y ajenas** (A5): hechas. Sigue pendiente transferir la Raíz.
- [x] **Roles personalizados e invitaciones** (A6): crear, editar y archivar roles, elegirlos al invitar y reenviar invitaciones. La edición existe en la API (G4); la pantalla para editar aún no.

Pendientes de fases posteriores:

- [ ] **Bloqueo de auditoría** (ADR 0023): el trigger mantiene el bloqueo por organización hasta el _commit_. Evaluar el impacto en transacciones largas.
- [ ] **Retención de auditoría** (ADR 0024) frente al borrado revocado: definir particionado o un rol de archivado.
- [x] **Índice ciego derivado de la clave de datos**: el plan deriva el índice ciego y las huellas de contraseña de la clave de datos. Al rotarla cambian todos los valores, así que cada rotación obliga a recalcular los índices (y, mientras conviven versiones, a buscar con ambas). El servicio de cifrado ya informa la versión de clave usada. Decidido ([ADR 0032](adr/0032-blind-index-derived-from-dek.md)): se mantiene derivado de la clave de datos; la clave estable por organización queda como plan B.
- [ ] **Generador de OpenAPI** desde Zod: aprobar la dependencia.
- [ ] **Versión de PostgreSQL**: decidido pasar a la 18 (2026-10-28); las pruebas aún usan 17. Falta subir la imagen y verificar las migraciones. Los UUIDv7 los sigue generando la función propia hasta que se decida usar la nativa.
- [ ] **`oidc-provider` sobre Fastify** (fase 2): está basado en Koa; validar con un _spike_ antes de comprometerse.
- [ ] **Trabajos en segundo plano multi-organización**: se necesita un camino para listar organizaciones sin contexto (función de listado propuesta en `docs/database.md` §7.5).
