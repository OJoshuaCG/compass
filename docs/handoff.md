# Traspaso: cómo retomar el proyecto en otro equipo

Documento de continuidad. Responde a tres preguntas: **dónde estamos**, **cómo se retoma el trabajo en otra máquina o equipo** y **qué sigue, en qué orden y por qué**. Se actualiza al cerrar cada tarea grande (ver `odd/tasks/`).

## 1. Dónde estamos (resumen)

| Fase | Estado | Evidencia |
| --- | --- | --- |
| 0 · Fundaciones | Hecha | Monorepo, base de datos con aislamiento por organización, criptografía, auditoría, esqueleto de interfaz oscura bilingüe, ADR 0001 a 0024 al cierre de la fase 0 (hoy el índice llega al 0038; el 0023 se aceptó el 2026-10-27 y el 0024 sigue como propuesta) |
| 1a · Identidad | **Funcionalmente completa; faltan piezas de cierre** (sección 4, pasos 2 a 6) | Invitación → contraseña → segundo factor obligatorio (TOTP en el alta; passkey opcional después) → sesión → reautenticación; matriz de jerarquía y 27 permisos; directorio; pantallas; pruebas de punta a punta incluso en navegador real. Cerradas en el bloque A: A1 (gestión de personas), A2 (passkeys), A3 (alta de organizaciones y códigos de emergencia de la Raíz), A4 (cambio obligatorio de la contraseña inicial de la Raíz), A5 (sesiones), A6 (roles e invitaciones), A7 (idempotencia) y A10 (reautenticación en navegador real). A8 en parte (correo SMTP del dominio propio hecho; Redis pendiente). A9 (CI en GitHub) despriorizada por el dueño |
| 1b · Bóveda y 2FA | **No iniciada.** Planificada en `odd/tasks/phase-1b-vault.md` (porciones B1 a B7 y tres decisiones abiertas) | Diseño de datos y cifrado ya listos (tablas, cifrado de secretos); falta toda la lógica de negocio y las pantallas |
| 1c · Gobernanza | No iniciada | La auditoría en cadena ya existe; faltan bajas con rotación, salud, acceso temporal y alertas |
| Puerta de producción | No iniciada | Exige prueba de penetración externa; **nada de esto debe cargar credenciales reales todavía** |
| 2 a 7 | No iniciadas | Ver el plan técnico |

Calidad verificada en la última ejecución completa: formato, compilación, tipos y análisis estático en verde; 612 pruebas de la API (unitarias y de integración contra PostgreSQL real), 295 de la web, 60 de `ui`, 55 de `db`, 13 de `contracts` y 17 de `i18n`; 10 pruebas en Chrome real (incluidas la reautenticación y una ceremonia de passkey con el autenticador virtual de Chrome). Revisión adversarial con dos jueces ciegos sobre A2, A3, A5, A6, A7 y A8, con todos los hallazgos confirmados corregidos (el detalle está en `odd/tasks/phase-1a-closure.md`), y pruebas de mutación manual sobre lo crítico. Las limitaciones conocidas están en la sección 8.

## 2. Qué NO está en el repositorio (y cómo recuperarlo)

| Elemento | Situación | Qué hacer |
| --- | --- | --- |
| **Remoto de git** | **Ya existe** (`origin`, en GitHub; 2026-10-27). Subir cambios sigue siendo una decisión del equipo | No subir nada sin esa decisión. Además, se puede generar una copia portátil: un archivo `iam.bundle` (ver sección 3) |
| Documento original del plan en Word | Sin versionar, solo en la máquina original | La versión viva es `plan.md`; el Word es la fuente del usuario |
| Reglas personales del autor (commits convencionales sin atribución de IA, respuestas breves, verificar antes de afirmar) | Viven en la configuración personal del autor, no en el repositorio | Están resumidas en `CLAUDE.md` y en la sección 6 de este documento |
| Registro de habilidades de las herramientas de IA | Generado automáticamente y ya excluido del repositorio | Se regenera solo; no importa |
| Clave local de pruebas del servicio de claves | Se crea sola al arrancar y está excluida del repositorio | No hay datos persistentes que recuperar: el entorno local es efímero |
| Secretos, contraseñas reales, datos de producción | **No existen.** Las únicas contraseñas son de prueba y están a la vista | Nada que migrar |

## 3. Cómo retomar en una máquina nueva

1. **Obtener el código.** Desde el remoto `origin` (con permiso del equipo) o restaurando la copia portátil con `git clone iam.bundle iam`.
2. **Instalar requisitos:** Node.js 24 o superior, pnpm 10, Podman o Docker (las pruebas de integración levantan PostgreSQL real) y Google Chrome (las pruebas de navegador lo usan; no descargan navegadores).
3. **Si se usa Podman,** activar el socket de usuario y exportar las dos variables descritas en el `README.md` (apuntar a ese socket y desactivar el contenedor auxiliar de limpieza). Sin esto, las pruebas de integración no encuentran el motor de contenedores.
4. **Instalar dependencias:** `pnpm install`. Las versiones están fijadas y hay una espera de 7 días tras cada publicación: una dependencia muy reciente no se instalará (es intencional).
5. **Comprobar que todo está sano, en este orden:** `pnpm format:check`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm e2e`. Si algo falla en una máquina limpia, es un defecto del traspaso: anótese en la sección 7.
6. **Probar a mano:** `pnpm stack` compila la API y la web, levanta PostgreSQL efímero, crea una organización con su Raíz y sirve la aplicación en `http://localhost:3100` (se usa `localhost` porque las passkeys exigen un dominio, no una IP). Imprime el correo y la contraseña de la Raíz y la dirección del buzón de pruebas (puerto 3101); la primera vez hay que cambiar esa contraseña inicial en `/password/change` y después registrar el segundo factor con una aplicación autenticadora. Esta pila no genera códigos de emergencia. El correo de las invitaciones no se envía: se lee en el buzón de pruebas.
7. **Leer, en este orden:** `docs/business/README.md` (qué hace el producto y por qué), `docs/business/roadmap-and-status.md` (estado por fase), este documento, `docs/architecture.md` y las guías `docs/backend.md`, `docs/frontend.md`, `docs/database.md`. El plan completo está en `plan.md`.

Para guardar una copia portátil del historial antes de mover el trabajo: `git bundle create iam.bundle --all`.

## 3 bis. Cómo se organiza el repositorio

| Carpeta | Contenido |
| --- | --- |
| `apps/api` | Servicio de backend por módulos (identidad, acceso, directorio, auditoría, criptografía, organización, notificación, aprovisionamiento e idempotencia) |
| `apps/web` | Aplicación web (pantallas de identidad, directorio, seguridad, sesiones y roles) |
| `packages/ui`, `packages/i18n`, `packages/contracts`, `packages/config` | Componentes y tokens, textos en español e inglés, contratos compartidos, configuración común |
| `db` | Migraciones numeradas, ejecutor de migraciones y pruebas del esquema |
| `e2e` | Pruebas en navegador real y la pila local completa |
| `docs` | Documentación (negocio, guías de ingeniería, decisiones, amenazas, procedimientos) |
| `odd/tasks` | Seguimiento de cada tarea grande: especificaciones, tareas y bitácora |

## 4. Plan de continuación (en orden recomendado)

Tamaños relativos: **S** (días), **M** (una a dos semanas), **L** (varias semanas). El plan técnico no fija fechas; estimar cada bloque al empezarlo.

### Qué sigue, en orden

1. **Fase 1b, porciones B1 a B7** (bloque B, abajo; especificaciones en `odd/tasks/phase-1b-vault.md`). Sus tres decisiones abiertas (sección 5) se resuelven antes de la porción que las usa: el límite de revelaciones por hora con su alerta y las reglas del motivo escrito antes de B2, y la biblioteca para leer códigos QR antes de B4 y B5. El ADR 0023 (bloqueo de auditoría en transacciones largas) ya se aceptó el 2026-10-27.
2. **Redis para los límites de intentos** (A8, parte pendiente). Hasta entonces, una sola instancia ([runbook](runbooks/single-instance-operation.md)).
3. **Trabajo de purga** de las filas vencidas de `idempotency_keys` y `webauthn_challenges` (necesita el camino para recorrer organizaciones, `docs/database.md` §7.5, y un ADR).
4. ~~Procedimiento de operaciones para la Raíz que olvida su contraseña y pierde sus factores~~ **Hecho (2026-10-27, [ADR 0037](adr/0037-root-recovery-dual-custody.md)).** Queda el runbook de caída total (códigos agotados), pendiente (TODO L3).
5. **Exigir passkeys como configuración de la organización**, cuando exista la pantalla de configuración (opcional hoy; decisión del dueño). Incluye decidir si la reautenticación admite passkey.
6. **Primera ejecución del CI en GitHub** (A9, despriorizada por el dueño).

Ninguna de las piezas 2 a 6 bloquea abrir la bóveda, pero todas deben cerrarse antes de la puerta de producción. **No cargar credenciales reales antes de terminar la fase 1 y de pasar la prueba de penetración externa.**

### Bloque A: Fase 1a (hecha en lo esencial; historial y pendientes)

La bóveda depende de personas gestionables, de sesiones controlables y de un acceso fuerte. Por eso iba primero.

| # | Tarea | Tamaño | Por qué ahora |
| --- | --- | --- | --- |
| A1 | **Gestión de personas:** cambiar rango, transferir responsable, suspender, desactivar con reasignación de subordinados, revocar sus sesiones al instante | M | **Hecha (2026-10-27).** `GET /users/managed` y `POST /users/:id/suspend`, `reactivate`, `deactivate`, `rank` y `manager`, con pestaña de gestión de equipo en la página de Usuarios. Detalle de reglas y errores en `odd/tasks/phase-1a-closure.md` (L2) |
| A2 | **Passkeys (WebAuthn)** como alternativa completa al código del autenticador; política de exigirlas a Raíz y Administradores | M | **Hecha y revisada (2026-10-27).** WebAuthn con verificación de usuario obligatoria y sin atestación; opcionales para todos, varias por persona (máximo 10). Ingreso: `POST /auth/passkey/options` y `/verify`. Gestión: `GET /me/passkeys`, `POST /me/passkeys/registration/options` y `/verify`, `POST /me/passkeys/:id/revoke`. Auditoría `auth.passkey_registered`, `auth.passkey_revoked` y `auth.passkey_login`. Web: `/security` y botón "Use a passkey" en el ingreso. Se agregan desde `/security` tras el alta inicial con TOTP (la reautenticación sigue pidiendo solo el código TOTP). Necesitan un dominio, no una IP: el identificador de la parte confiable y el origen salen de `APP_ORIGIN`. Exigirlas a la Raíz y a los Administradores queda como futura configuración de la organización (ver sección 5). Detalle en `odd/tasks/phase-1a-closure.md` (L4) |
| A3 | **Alta de organizaciones como comando de operaciones**, con auditoría y códigos de emergencia de la Raíz | S | **Hecha (2026-10-27).** `pnpm --filter @iam/api provision` (variables `PROVISION_DATABASE_URL`, `ORG_NAME`, `ORG_SLUG`, `ROOT_EMAIL` y `ROOT_NAME`) imprime una sola vez la contraseña inicial y 8 códigos de emergencia de un solo uso (solo se guardan como hash; columna `kind`, migración 0010), para imprimirlos y entregarlos a los dos custodios. Usar uno, tras la contraseña, restablece el segundo factor de la Raíz, la deja con el registro pendiente, cierra sus demás sesiones, audita `auth.emergency_code_used` y avisa por correo a los Administradores activos (si falla o no hay destinatarios, `auth.emergency_alert_incomplete`). **Limitación:** olvidar la contraseña Y perder los factores no tiene recuperación en el sistema; falta un procedimiento de operaciones. Pasos operativos en los runbooks de [alta](runbooks/provision-organization.md) y de [uso de un código](runbooks/use-emergency-code.md) |
| A4 | **Cambio obligatorio de la contraseña inicial de la Raíz** | S | **Hecha (2026-10-27).** `POST /auth/password/change`, bloqueo del segundo factor con `AUTH.PASSWORD_CHANGE_REQUIRED` hasta cambiarla y pantalla `/password/change` |
| A5 | **Sesiones:** ver y cerrar las propias, cierre por el responsable, sincronización entre pestañas | S | **Hecha (2026-10-27).** `GET /me/sessions`, `POST /me/sessions/:id/revoke` (404 si no es suya o está cerrada; 422 si es la actual) y `POST /users/:id/sessions/revoke` (`user.deactivate`, jerarquía, Raíz protegida). Auditoría `auth.session_revoked` y `user.sessions_revoked`. Web: `/sessions`, "Cerrar sesiones" en el menú de fila del equipo y sincronización con `BroadcastChannel` (solo viaja el nombre de un evento). Una sesión está viva si no está revocada, no venció y tuvo actividad en los últimos 30 minutos |
| A6 | **Reenvío de invitación** (invalida la anterior) y **roles personalizados** (crear, asignar, límites de no escalamiento) desde la interfaz | M | **Hecha (2026-10-27).** `GET /roles` (`user.invite`), `POST /roles` (`role.manage`; `403 AUTHZ.ROLE_ESCALATION`, `409 ROLE.NAME_TAKEN`), `POST /roles/:id/archive` (`403 ROLE.SYSTEM_PROTECTED`), `GET /invitations` y `POST /invitations/:id/resend`. Auditoría `role.created`, `role.archived` y `user.invitation_resent`. Web: pestaña "Invitaciones", elección de "Roles" al invitar y pantalla `/roles`. Edición de roles ya creados: `PATCH /roles/:id` (G4, ver `docs/backend.md`); falta su pantalla |
| A7 | **Idempotencia** de las peticiones que crean recursos | S | **Hecha (2026-10-27).** Cabecera `Idempotency-Key` en `POST /invitations`, `POST /invitations/:id/resend` y `POST /roles`; detalle y errores en `docs/backend.md` §7.2.1. **Limitaciones:** las filas vencidas no se purgan (falta un trabajo de limpieza) y el reintento no vuelve a comprobar permisos durante las 24 horas |
| A8 | **Límites de intentos compartidos entre instancias** (Redis) y **correo real** (proveedor definido) | M | **Parcial (2026-10-27).** Correo hecho por SMTP del dominio propio (ver sección 5, `docs/backend.md` §6.3.1 y el [runbook](runbooks/configure-mail.md)). **Pendiente: Redis**; el bloqueo y el límite por IP siguen siendo por instancia |
| A9 | **Ejecutar el CI en GitHub** y corregir lo que falle; añadir los escáneres de seguridad que pide el plan | S | **Despriorizada por el dueño (2026-10-27), no bloqueada.** El repositorio ya tiene remoto, pero el dueño la consideró "no primordial ni requerida por nosotros". El CI nunca ha corrido allí |
| A10 | **Reautenticación en navegador real** y reautenticación con código de recuperación | S | **Hecha en lo esencial (2026-10-27).** La suite de Chrome (hoy 10 pruebas) cubre cambiar rango, el diálogo "Confirm your identity", código incorrecto rechazado y código correcto que completa la acción. **No se soporta** la reautenticación con código de recuperación (solo TOTP); sigue como decisión abierta |

### Bloque B: Fase 1b, bóveda y 2FA (no iniciada)

Las porciones son verticales (casos de uso, API, pantalla, pruebas y documentación) y siguen el orden de dependencia de `odd/tasks/phase-1b-vault.md`, donde están sus especificaciones:

| Porción | Contenido |
| --- | --- |
| B1 | Acceso efectivo y cuentas: catálogo de plataformas (lectura), crear, editar y archivar cuentas, listado filtrado por acceso efectivo y pantalla de cuentas |
| B2 | Credenciales: crear, cambiar contraseña con versiones y huella, historial sin contenido, copiar usuario; revelar contraseña con reautenticación, motivo, límite por hora y ocultado a los 30 s |
| B3 | Compartición y grupos: por persona y por grupo, caducidad, no compartir más de lo propio, tarea de rotación al revocar tras una revelación |
| B4 | Segundo factor en el servidor: registro (validación, confirmación, pendiente 24 h), código bajo demanda, exportar, re-registrar y retirar; registro por clave manual y por imagen |
| B5 | Registro por captura de pestaña, importación de Google Authenticator y entrega por celular (requiere decidir la biblioteca para leer QR) |
| B6 | Búsqueda avanzada, índice ciego por usuario y vistas guardadas |
| B7 | Importación por CSV |

El plan técnico estima la fase en conjunto (cuentas, secretos y compartición, M cada una; los cinco métodos del segundo factor, L; importación, búsqueda y vistas, S).

### Bloque C: Fase 1c y puerta de producción

Auditoría con pantalla, bajas con tareas de rotación, salud de credenciales, acceso temporal, alertas críticas (L). Después: prueba de penetración externa, simulacro de restauración y ensayo de los procedimientos. **No cargar credenciales reales antes.**

### Después

Fases 2 a 7 según `plan.md` (proveedor de inicio de sesión único, SAML, correos, SMS, extensión de navegador, broker). Cada una se abre cuando la anterior cumple sus criterios de salida.

## 5. Decisiones abiertas

**Del equipo (bloquean o condicionan; ya estaban en el plan):** disponibilidad requerida (el proveedor de nube y la escala del primer año ya se decidieron: Dokploy en Linode con AWS KMS, y menos de 20 clientes); subdominio para los alias de cuentas; presupuesto de la prueba de penetración; política de retención; elegibilidad de Meta para la fase 3; identidad de las dos personas que custodian los códigos de emergencia. Exigir passkeys a Raíz y Administradores ya no está abierta como pregunta: se decidió que sean opcionales y la exigencia queda como futura configuración (ver abajo).

**Decisiones del dueño (2026-10-27):**

| Tema | Decisión | Razón o efecto |
| --- | --- | --- |
| A3 códigos de emergencia | Solo las personas que custodian los códigos pueden restablecer la Raíz; NINGÚN Administrador puede restablecerla (solo reciben la alerta) | Un Administrador capaz de restablecer la Raíz sería un camino para tomar la cuenta de mayor privilegio. Implementado (ver A3 en la sección 4 y el [ADR 0027](adr/0027-emergency-codes-root-reset-model.md)) |
| A2 passkeys | Dejado al criterio de ingeniería; elegido: opcionales para todos, como alternativa al código del autenticador al iniciar sesión (resistente al phishing), varias por persona. Exigirlas a la Raíz y a los Administradores queda como futura configuración de la organización ([ADR 0028](adr/0028-passkeys-optional-enforcement-later.md)) | Aún no hay pantalla de configuración, y un registro forzado sin alternativa arriesga dejar a las personas fuera |
| A8 correo | El correo sale del dominio PROPIO de la organización (no Gmail ni Outlook): SMTP genérico de ese dominio. Redis para los límites de intentos NO forma parte de esta entrega (el dueño solo respondió sobre el correo) | Redis sigue como pendiente |
| A9 CI en GitHub y escáneres | Puesta aparte: "no es primordial ni lo requerimos" | Despriorizada por el dueño, no bloqueada. El repositorio ya tiene remoto |

**Nota de negocio para el dueño:** para que el correo llegue a la bandeja de entrada, el dominio necesita registros SPF, DKIM y DMARC en el DNS (fuera del sistema).

**Surgidas al construir (requieren criterio de negocio):**

| Tema | Hoy | Pregunta |
| --- | --- | --- |
| Permisos por defecto de Líder y Operador | **Decidido 2026-10-27 (B5):** el Operador pierde `credential.reveal_password` por defecto (defensa en profundidad: revelar exige además una compartición VIEW); compartir ya exige nivel MANAGE. Los roles personalizados pueden volver a otorgarlo | **Aplicado en código** (`system-roles.ts`, `SYSTEM_ROLES_VERSION = 2`). Falta sincronizar el rol Operador de las organizaciones ya creadas: nada compara la versión y la tabla `roles` tiene RLS forzado, así que requiere una vía de aislamiento con encargo humano |
| Responsable de la persona invitada | Siempre quien invita | El plan sugiere que quien invita lo define |
| Reautenticación | **Decidido 2026-10-27 ([ADR 0033](adr/0033-reauthentication-totp-and-passkey.md)):** TOTP o passkey; nunca el código de recuperación | **Implementado** (`POST /auth/reauth/passkey/options` y `/verify`, migración 0012; fallos auditados como `auth.reauth_failed`; el diálogo de reautenticación ofrece la passkey si la persona tiene una). Sin pruebas e2e de navegador |
| Archivar un rol personalizado | Un rol archivado deja de otorgar sus permisos y no sirve en invitaciones nuevas | ¿Es el efecto deseado sobre quien ya lo tenía asignado? |
| Directorio visible | Muestra nombre, correo y rango; solo personas activas | ¿Rango visible o solo nombre y correo? |
| Índice ciego derivado de la clave de datos | **Decidido 2026-10-27 ([ADR 0032](adr/0032-blind-index-derived-from-dek.md)):** se mantiene derivado de la DEK; el recálculo va en el job de recifrado | Clave estable por organización queda como plan B |
| ADR 0023 (bloqueo de auditoría) | Aceptado el 2026-10-27; `lock_timeout` de 5 s con falla cerrada implementado (`AUDIT.LOCK_TIMEOUT`, 503). Faltan medir la latencia p95 y decidir la agrupación de negaciones | Medir p95 con escritores concurrentes; el evento de auditoría debe seguir siendo lo último de cada caso de uso |
| ADR 0024 (retención de auditoría) | Propuesto, sin decidir | Decidir antes de la auditoría con retención (fase 1c) |
| Versión de PostgreSQL | Pruebas con la 17 | ¿Pasar a la 18 (identificadores ordenables nativos)? |
| Proveedor de inicio de sesión único sobre Fastify | Sin probar | Hacer una prueba corta antes de la fase 2 |

**Decisiones abiertas de la fase 1b** (de `odd/tasks/phase-1b-vault.md`; ninguna está resuelta):

| Tema | Pregunta | Se necesita antes de |
| --- | --- | --- |
| Biblioteca para decodificar códigos QR en el navegador | **Propuesta 2026-10-27 (B7):** jsQR, versión exacta y espera de 7 días, cargada con import dinámico en la ruta de registro 2FA para respetar el presupuesto de JS inicial. Sin mantenimiento desde 2021 (riesgo aceptado). Los datos de versión no se han verificado: confirmarlos antes de aprobar la dependencia | B4 y B5 |
| Límite de revelaciones por usuario y hora | **Decidido 2026-10-27 ([ADR 0031](adr/0031-reveal-rate-limit-per-user.md)):** 30 por hora; aviso por correo a la Raíz | B2 |
| Motivo escrito al revelar | **Decidido 2026-10-27 (B3):** categoría de lista cerrada obligatoria más texto corto (10 a 200 caracteres) con aviso "no pegues secretos". La auditoría es append-only: el texto libre no se puede purgar | B2 |
| Recorte de la primera entrega de 2FA | **Decidido 2026-10-27 (B8):** v1 con clave manual, imagen y captura de pestaña; importación de Google Authenticator y entrega por celular pasan a v1.1. Enmienda el ADR 0017. Una futura `Permissions-Policy` debe permitir `display-capture=(self)` | N3 |

## 6. Cómo se trabaja aquí (convenciones)

- **Método:** cada tarea grande tiene un documento en `odd/tasks/` con especificaciones (citando lo pedido), tareas y bitácora. Se trabaja en ciclos de implementar, ejecutar pruebas y corregir, **hasta 5 iteraciones** por tarea.
- **Revisión adversarial:** para código sensible (identidad, acceso, criptografía, auditoría, interfaz de sesión) se usan dos revisores ciegos con el mismo alcance congelado; solo se corrige lo que ambos confirman; hasta dos rondas de corrección y re-revisión. Complementa con **mutación manual**: romper a propósito la regla y comprobar que alguna prueba falla; si ninguna falla, la prueba no sirve.
- **Rutas protegidas** (identidad, acceso, criptografía, auditoría, migraciones con aislamiento, CSP y cabeceras, revelación de secretos): cambios solo por encargo humano explícito, con revisión doble.
- **Dependencias:** versión exacta, antigüedad mínima de 7 días y aprobación humana. TypeScript se mantiene en 6.0 (la 7 rompe el análisis estático) y todo el repositorio es ESM.
- **Commits:** convencionales, por parte terminada, **sin líneas de atribución a herramientas de IA**. No se sube nada al remoto sin decisión del equipo.
- **Documentación:** la de `docs/business` describe solo lógica de negocio, sin código; las guías de ingeniería explican reglas y decisiones sin pegar código.
- **Agentes:** funcionan bien los de documentación, base de datos, frontend, control de versiones y los dos revisores ciegos. Los revisores de la familia "review-*" **no sirven aquí** salvo con la herramienta nativa de revisión instalada.

## 7. Trampas conocidas del entorno

| Síntoma | Causa | Solución |
| --- | --- | --- |
| Las pruebas de integración no encuentran el motor de contenedores | Podman sin socket o variables sin exportar; Turborepo filtra el entorno | Variables del `README.md`; el repositorio ya las deja pasar en `turbo.json` |
| El análisis estático falla con TypeScript 7 | Aún no es compatible | No actualizar por encima de 6.0 |
| Un servidor Nest muere sin mensaje al arrancar | Por defecto aborta el proceso ante errores de inicio | Ya se desactivó: ahora falla con mensaje y código de salida |
| Las pruebas se cuelgan con muchas peticiones simultáneas | Agotamiento del pool de conexiones por transacciones anidadas | Las transacciones independientes usan un pool propio |
| Un código TOTP repetido se rechaza en las pruebas | Protección contra reutilización (intencional) | Generar códigos de pasos nuevos; esperar al siguiente paso si hace falta |
| Violación de CSP al abrir un diálogo | Una hoja de estilos fija de la biblioteca de diálogos | Permitida por hash exacto; si se actualiza la biblioteca, la prueba de navegador dará el hash nuevo |
| Pruebas de interfaz intermitentes bajo carga | Tiempos de espera por defecto muy ajustados | Ya ampliados; no volver a los valores por defecto |
| Una prueba de web falla a veces al afirmar justo después del encabezado | La consulta de datos aún no había terminado | Corregida esperando la consulta; ante una prueba intermitente se arregla la espera, no se suben reintentos |
| Terminar procesos con `pkill -f` mata la propia terminal | El patrón coincide con la línea de comandos | Usar el identificador exacto del proceso |
| Una dependencia recién publicada no se instala | Espera de 7 días (intencional) | Elegir una versión más antigua |

## 8. Deuda y riesgos conocidos

- El tamaño inicial del JavaScript del frontend mide cerca de 200,04 KB comprimido, 0,04 KB por encima de la propuesta de partida de 200 KB (no se hace cumplir; se justifica por la ruta diferida nueva y los hashes del catálogo).
- El bloqueo de intentos y el límite por IP son por instancia y viven en memoria hasta incorporar Redis (pendiente): el sistema debe operar con una sola instancia ([runbook](runbooks/single-instance-operation.md)).
- Las filas vencidas de `idempotency_keys` y `webauthn_challenges` se purgan con el comando `purge-expired` ([ADR 0038](adr/0038-purge-expired-ephemeral-rows.md)), que alguien debe programar; el reintento idempotente no vuelve a comprobar permisos durante las 24 horas. La idempotencia nunca se aplica a endpoints cuya respuesta lleve secretos.
- Las opciones de ingreso con passkey devuelven los identificadores de las credenciales de quien ya verificó la contraseña.
- Recuperación de la Raíz: con los códigos de emergencia se recupera quien conserva la contraseña. Quien pierde contraseña y factores se recupera con el comando `recover-root` (control dual de dos custodios, ADR 0037, aceptada con confirmación pendiente del dueño; runbook [recover-root](runbooks/recover-root.md)), que emite además códigos nuevos. Siguen sin cobertura: reemitir códigos sin recuperar a la Raíz y haber agotado los códigos de un custodio (caída total).
- Las passkeys no se exigen a nadie, y la reautenticación solo acepta el código TOTP (ni passkey ni código de recuperación).
- Correo: el de invitación y el aviso de uso de un código de emergencia salen por SMTP del dominio propio ([runbook](runbooks/configure-mail.md)); salen también los avisos a la persona por uso de un código de recuperación y por alta o baja de una llave de acceso (G5); siguen sin existir los de dispositivo nuevo, baja del factor de aplicación y regeneración de códigos. El dominio necesita SPF, DKIM y DMARC en el DNS.
- Producción: el adaptador de AWS KMS existe (`KMS_ADAPTER=aws`, L1, [ADR 0020](adr/0020-reference-cloud-aws.md)) pero nunca se probó contra AWS real ni hay comprobación de permisos al arrancar; el adaptador local sigue negándose a arrancar con `NODE_ENV=production`. No existe el punto de entrada del worker. El despliegue acordado (Dokploy, PostgreSQL dedicado) está en [`deployment.md`](deployment.md), con el `Dockerfile` sin construir y sin ensayar; la estrategia de respaldos sigue sin definir.
- Configuración: no existe `.env.example`; la fuente de verdad de las variables de entorno es `apps/api/src/app/config.ts` (resumida en `docs/backend.md` §6.3.1 y §6.3.2). Se validan al arrancar y el servicio no inicia con una configuración inválida.
- El CI de GitHub (`.github/workflows/ci.yml`) nunca se ha ejecutado y no incluye aún los escáneres de seguridad. El dueño lo despriorizó (2026-10-27); el repositorio ya tiene remoto.

## 9. Mapa de documentación

| Pregunta | Documento |
| --- | --- |
| ¿Qué hace el producto y qué reglas aplica? | `docs/business/` |
| ¿Cómo está construido? | `docs/architecture.md`, `docs/backend.md`, `docs/frontend.md`, `docs/database.md` |
| ¿Por qué se decidió así? | `docs/adr/` (0001 a 0040) |
| ¿Qué amenazas se contemplan? | `docs/threat-model.md` |
| ¿Cómo se opera el sistema y qué hacer ante un incidente? | `docs/runbooks/` (alta de organizaciones, código de emergencia, correo, una sola instancia e incidentes; borradores, sin ensayar) |
| ¿Qué se hizo y qué se encontró en cada tarea? | `odd/tasks/` |
| ¿Qué sigue? | Este documento, sección 4 ("Qué sigue, en orden") |
