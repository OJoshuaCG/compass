# Plan técnico — Plataforma interna de identidad, accesos y bóveda

Oct 26, 2026 · @Orlando

## Resumen ejecutivo

Construiremos un monolito modular en NestJS (TypeScript), con arquitectura hexagonal por módulo, PostgreSQL y cifrado de sobre con KMS. La fase 1 entrega identidad propia, jerarquía de 4 actores, permisos, bóveda compartida y 2FA; las fases siguientes convierten el sistema en proveedor SSO (OIDC, luego SAML/SCIM), agregan lectura de códigos por correo y SMS, y al final un broker de sesiones tipo Cerby.

El producto es interno y de una sola organización, pero cada tabla nace con `organization_id` y Row-Level Security, así que pasar a multitenancy es activar una segunda organización, no migrar datos.

El principio rector: todo el producto se construye a la medida, pero ninguna primitiva de seguridad se reinventa. Criptografía, JWT, hashing, WebAuthn, TOTP y protocolos SSO usan bibliotecas auditadas.

### Decisiones cerradas (ADR)

| ADR | Decisión | Por qué |
| --- | --- | --- |
| 001 | Monolito modular, hexagonal por módulo | Un equipo de 3 no puede operar microservicios; los límites de módulo permiten separar procesos después |
| 002 | NestJS + TypeScript de punta a punta, monorepo | Conocimiento del equipo; tipos y esquemas compartidos entre API, web y futura extensión |
| 003 | PostgreSQL como única fuente de verdad | Transacciones, RLS, JSONB para configuración de plataformas |
| 004 | Cifrado del lado del servidor con KMS y DEK por organización | Requisitos de compartición, acceso del dueño raíz, recuperación y lectura de correos; zero-knowledge los contradice |
| 005 | Caché en memoria de DEK descifradas, TTL 10 min | Reduce llamadas al KMS a decenas por hora; nunca en Redis ni en disco |
| 006 | Multitenancy preparada: `organization_id` + RLS en todas las tablas | Costo casi nulo hoy; el retrofit posterior es de los más caros |
| 007 | 4 actores: Raíz, Administrador, Líder, Operador | Resuelve la contradicción "un dueño / varios del mismo nivel" |
| 008 | Autoridad = rango estrictamente inferior + subárbol de gestión | Combina las reglas de nivel y de linaje |
| 009 | `created_by` inmutable separado de `managed_by` transferible | Las bajas no dejan usuarios huérfanos |
| 010 | Gestionar personas no da acceso a secretos | El acceso a secretos solo vía compartición explícita y auditada |
| 011 | Autorización en tres ejes: jerarquía, permisos (RBAC), alcance (ACL) | Cada eje responde una pregunta distinta y crece por separado |
| 012 | Nadie otorga un permiso que no tiene | Evita escalamiento de privilegios por delegación |
| 013 | Códigos TOTP generados en el servidor; el secreto no sale | Un operador puede usar el 2FA sin poder llevárselo |
| 014 | Sesiones de servidor con cookie, no JWT, para la propia app | Revocación inmediata, sin tokens en el navegador |
| 015 | MFA obligatorio; passkeys como método preferido | El sistema protege el 2FA de toda la organización |
| 016 | Auditoría append-only con encadenamiento de hashes | Evidencia a prueba de manipulación; si falla la auditoría, la acción sensible se rechaza |
| 017 | Cinco métodos de registro de 2FA, todos disponibles | Requisito de dar opciones; captura de pantalla como método destacado |
| 018 | Proveedor SSO con `oidc-provider` (fase 2) y SAML (fase 3) | Motor de protocolo certificado; el resto a la medida |
| 019 | Broker tipo Cerby: puertos e interfaces listos desde la fase 1, implementación al final | Es lo más complejo y frágil; se prepara sin construirlo |
| 020 | Nube de referencia AWS, adaptadores intercambiables | El dominio no depende del proveedor; ver decisiones pendientes |

## Alcance y hoja de ruta por fases

La fase 1 se divide en tres entregas (identidad, bóveda con 2FA y gobernanza) y llega a producción interna solo después de un pentest externo. Las fases siguientes se abren de una en una, y el broker tipo Cerby queda al final por ser lo más frágil.

&#91;embedded content: hoja de ruta · 10 entregas, 1 gate de producción\]

Cada fase entrega algo usable y no se abre la siguiente hasta cumplir sus criterios de salida. La fase 3 tiene además su propio gate: confirmar la elegibilidad de la organización para managed Meta accounts.

### Criterios de salida por fase

| Fase | Se considera terminada cuando |
| --- | --- |
| 0 · Fundaciones | CI completo en verde; módulos crypto, auditoría y contexto de organización con pruebas; RLS activo; esqueleto de UI con tokens oscuros y i18n; ADR 001 a 020 escritos |
| 1a · Identidad | Invitación → contraseña → MFA obligatorio → login con passkey de punta a punta; matriz de jerarquía y permisos completa en verde; reautenticación funcionando |
| 1b · Bóveda y 2FA | Alta de cuentas y credenciales, compartición por usuario y grupo, revelación auditada, los 5 métodos de registro 2FA con confirmación, códigos generados en servidor |
| 1c · Gobernanza | Auditoría con cadena verificada y UI; baja con reasignación y tareas de rotación; panel de salud; JIT; alertas críticas activas |
| Gate de producción | Pentest externo sin hallazgos altos ni críticos abiertos; simulacro de restauración exitoso; runbooks ensayados |
| 2 · SSO OIDC | Al menos una app interna con login, logout back-channel y revocación al desactivar usuarios |
| 3 · SAML y SCIM | Login a Meta Business con managed Meta accounts y baja automática verificada |
| 4 · Correos | Códigos extraídos para las plataformas del catálogo, con DKIM verificado y TTL |
| 5 · SMS | Números operativos para plataformas sin TOTP |
| 6 · Extensión | Autocompletado de usuario y 2FA desde la extensión con sesión de dispositivo |
| 7 · Broker | Login con nivel USE sin revelar contraseña en al menos una plataforma, con monitoreo de fallas |

No se estiman fechas en este plan: dependen de la escala, la disponibilidad del equipo y los hallazgos del pentest. Se recomienda estimar cada fase al cerrar la anterior.

## Arquitectura

Un monolito modular: un repositorio, una imagen de contenedor y dos procesos (API y worker), con módulos que solo se hablan por fachadas públicas o eventos. Es la opción más simple que tres personas pueden operar, y los límites de módulo permiten separar un módulo en su propio servicio más adelante sin reescribirlo.

&#91;embedded content: arquitectura · 12 módulos, 2 procesos, 5 servicios gestionados\]

Los módulos con borde discontinuo existen desde el inicio como carpetas con sus puertos definidos, pero sin adaptadores. Solo `crypto` habla con el KMS y solo él importa primitivas criptográficas.

### Responsabilidad de cada módulo

| Módulo | Responsabilidad | Expone |
| --- | --- | --- |
| `organization` (kernel) | Organizaciones, contexto de petición, configuración | `RequestContext`, configuración por organización |
| `identity` | Invitaciones, contraseñas, passkeys, TOTP propio, sesiones, reautenticación | Autenticar, verificar sesión, exigir reautenticación |
| `directory` | Usuarios, rangos, responsable, grupos, membresías | Consultas de jerarquía y subárbol, eventos de baja |
| `access` | Catálogo de permisos, roles, compartición, motor de decisión | `Authorizer.authorize()`, vista de acceso efectivo |
| `vault` | Plataformas, cuentas, credenciales, versiones de secretos | Casos de uso de la bóveda |
| `totp` | Registro (5 métodos), handoff, generación de códigos | Código actual de una credencial |
| `crypto` | `SecretCipher`, caché de DEK, rotación, índices ciegos | Cifrar, descifrar, HMAC por propósito |
| `audit` | Escritura encadenada, verificación, consulta, exportación | `AuditLog.record()` dentro de la transacción |
| `governance` | Bajas con rotación, salud, acceso temporal | Tareas de rotación, paneles |
| `notification` | Correos traducidos, SSE, alertas | Enviar, publicar evento al cliente |
| `federation` (futuro) | OIDC, SAML, SCIM | Fases 2 y 3 |
| `inbound-codes` (futuro) | Ingesta de correos y SMS | Fases 4 y 5 |
| `broker` (futuro) | Intenciones de login, sesiones delegadas | Fases 6 y 7 |

### Comunicación entre módulos

- **Síncrona**: un módulo llama a la fachada pública de otro (`index.ts`). Por ejemplo, `vault` llama a `access.Authorizer` y a `crypto.SecretCipher`.
- **Asíncrona**: eventos de dominio guardados en `outbox_events` en la misma transacción y publicados por el worker. Por ejemplo, `directory` emite `UserDeactivated` y `governance` crea las tareas de rotación.
- **Prohibido**: importar repositorios, entidades o tablas de otro módulo. Lo verifica el lint.

### Estructura del repositorio

```
/
├─ apps/
│  ├─ api/                 # NestJS: main.http.ts, main.worker.ts, main.migrate.ts
│  │  └─ src/modules/
│  │     └─ vault/
│  │        ├─ domain/          # entidades, políticas, errores (TS puro)
│  │        ├─ application/     # casos de uso y puertos
│  │        ├─ infrastructure/  # repositorios Drizzle, adaptadores
│  │        ├─ interface/       # controladores, mapeo a contratos
│  │        ├─ index.ts         # fachada pública del módulo
│  │        ├─ README.md
│  │        └─ CLAUDE.md        # solo en módulos protegidos
│  ├─ web/                 # SPA React
│  └─ mobile-handoff/      # página ligera de cámara para 2FA
├─ packages/
│  ├─ contracts/           # esquemas Zod, tipos, códigos de error
│  ├─ i18n/                # catálogos es y en
│  ├─ ui/                  # tokens de diseño y componentes
│  └─ config/              # ESLint, TSConfig, reglas de límites
├─ db/migrations/          # SQL versionado, con RLS por tabla
├─ docs/                   # adr/, runbooks/, threat-model.md, architecture.md
└─ CLAUDE.md
```

## Stack tecnológico y bibliotecas aprobadas

Cada biblioteca de esta lista resuelve un problema donde reinventar sería un riesgo. Agregar otra exige aprobación humana (ver reglas de desarrollo); las versiones se fijan exactas y se revisan antes de actualizar.

### Plataforma

| Capa | Elección | Por qué |
| --- | --- | --- |
| Runtime | Node.js LTS (versión par vigente) | Soporte largo; nunca versiones impares en producción |
| Lenguaje | TypeScript en modo `strict` | Ver reglas de código |
| Framework API | NestJS con adaptador Fastify | Módulos, DI, guards; Fastify rinde más que Express |
| Base de datos | PostgreSQL 16 o superior | RLS, JSONB, índices parciales |
| Acceso a datos | Drizzle ORM + migraciones SQL versionadas | SQL explícito y tipado; control de `SET LOCAL` para RLS dentro de transacciones |
| Colas y jobs | BullMQ sobre Redis | Rotaciones, expiraciones, recifrado, envío de correos |
| Caché y rate limiting | Redis | Contadores y sesiones calientes; nunca material criptográfico |
| Validación | Zod, esquemas compartidos API/web | Una sola definición por contrato |
| Monorepo | pnpm workspaces + Turborepo | Builds incrementales; paquetes compartidos |
| Frontend | React + Vite (SPA), TanStack Router y Query | App interna sin SEO; servida en el mismo origen que la API |
| UI | Tailwind con tokens de diseño + primitivas Radix | Accesibilidad resuelta; tema oscuro único por tokens |
| Formularios | react-hook-form + Zod | Mismos esquemas que la API |
| i18n | i18next (web y API), ICU para plurales | Mensajes de error, correos y UI en es y en |

### Seguridad (no se reimplementan)

| Necesidad | Biblioteca | Notas |
| --- | --- | --- |
| Hash de contraseñas | `@node-rs/argon2` (Argon2id) | Parámetros mínimos OWASP; recalibrar por hardware |
| Cifrado simétrico | `node:crypto` AES-256-GCM | Encapsulado en el módulo crypto; nadie más lo llama |
| KMS | SDK oficial del proveedor (AWS KMS de referencia) | Detrás del puerto `KeyManagementPort` |
| JWT / JWK / JWS | `jose` | Lista blanca de algoritmos; nunca `alg` del token |
| Passkeys / WebAuthn | `@simplewebauthn/server` y `/browser` | Verificación de origen y RP ID |
| TOTP / HOTP | `otplib` | Soporta SHA1/256/512, 6 u 8 dígitos, 30 o 60 s |
| Proveedor OIDC (fase 2) | `oidc-provider` (certificado OpenID) | Adaptadores propios a PostgreSQL |
| SAML IdP (fase 3) | `samlify` + validador XML endurecido | Revisión de seguridad dedicada antes de producción |
| Decodificar QR (web) | `BarcodeDetector` nativo con respaldo `@zxing/browser` | Se decodifica en el cliente |
| Fuerza de contraseña | `@zxcvbn-ts/core` | Puntaje calculado al guardar |
| Rate limiting | `rate-limiter-flexible` sobre Redis | Por usuario, IP y acción |
| Cabeceras HTTP | `@fastify/helmet` | CSP estricta definida por nosotros |
| Logs | `pino` con redacción de rutas sensibles | JSON estructurado |
| Trazas y métricas | OpenTelemetry | Exportable a cualquier backend |

### Pruebas y calidad

Vitest (unitarias e integración), Testcontainers (PostgreSQL y Redis reales), Playwright (e2e), Stryker (mutación en módulos críticos), ESLint con `eslint-plugin-boundaries`, dependency-cruiser, Semgrep, gitleaks, osv-scanner y Trivy.

## Multitenancy preparada desde el día uno

Una sola organización en producción, con aislamiento por tenant aplicado en tres capas: aplicación, base de datos y criptografía. Si una capa falla, las otras dos contienen el error.

### Capa 1: contexto de petición

- La organización se resuelve desde la sesión autenticada, nunca desde un parámetro que el cliente envía.
- Un `RequestContext` (AsyncLocalStorage) transporta `organizationId`, `actorId`, `requestId` y la frescura de la reautenticación.
- Los repositorios leen el contexto; ningún caso de uso recibe `organizationId` como argumento libre.

### Capa 2: Row-Level Security en PostgreSQL

- Toda tabla de dominio tiene `organization_id uuid not null` y una política RLS: `organization_id = current_setting('app.org_id')::uuid`.
- Cada transacción ejecuta `SET LOCAL app.org_id = '<uuid>'` al iniciar. Sin esa variable, las consultas devuelven cero filas (falla cerrada).
- La aplicación se conecta con un rol sin `BYPASSRLS` y que no es dueño de las tablas. Las migraciones usan otro rol.
- Los índices compuestos empiezan por `organization_id`.
- El catálogo global de plataformas usa `organization_id` nulo, con una política de solo lectura para esas filas.

### Capa 3: claves por organización

Cada organización tiene su propia clave de datos (DEK), cifrada por su propia clave en el KMS. Un error de aislamiento en la base de datos devolvería texto cifrado que la DEK de otra organización no puede abrir, porque el AAD incluye el `organization_id` (ver diseño criptográfico).

### Identidad y organizaciones

En v1, cada usuario pertenece a una organización y el correo de login es único globalmente. Si en el futuro una misma persona necesita entrar a varias organizaciones, se introduce una tabla `identities` (persona) separada de `memberships` (pertenencia). Queda registrado como ADR futuro; no se construye ahora.

### Qué NO se construye todavía

Alta de organizaciones por autoservicio, facturación, dominios personalizados por tenant y consola de superadministración. Cuando llegue la segunda organización, se crea por script de operación auditado.

### Pruebas obligatorias de aislamiento

Una suite de integración crea dos organizaciones con datos equivalentes y verifica, para cada repositorio, que la organización A nunca lee, modifica ni cuenta filas de B. Esta suite corre en cada PR.

## Actores y jerarquía: reglas formales

Hay cuatro actores con rango numérico; un rango menor significa más autoridad. Un actor gestiona a otro solo si el otro tiene rango estrictamente mayor y está en su subárbol de gestión; la Raíz gestiona a todos.

| Actor | Rango | Cuántos | Crea a | Gestiona a |
| --- | --- | --- | --- | --- |
| Raíz (dueño) | 0 | Exactamente 1 por organización | Administrador, Líder, Operador | Todos |
| Administrador | 1 | Varios | Líder, Operador | Su subárbol de rango 2 y 3 |
| Líder | 2 | Varios | Operador | Su subárbol de rango 3 |
| Operador | 3 | Varios | Nadie | Nadie |

Resolución de la contradicción de creación: **solo la Raíz crea Administradores**. Así, ningún actor crea a alguien de su mismo rango que luego no podría gestionar.

### Regla de gestión

```
puedeGestionar(A, T) =
     A.activo
  ∧  A.organizacion = T.organizacion
  ∧  A ≠ T
  ∧  ( A.rango = RAIZ  ∨  ( A.rango < T.rango  ∧  T ∈ subarbol(A) ) )

subarbol(A) = usuarios cuya cadena managed_by llega a A
```

Ejemplo resuelto: Ana (Administradora) crea a Luis (Líder). Pedro (Administrador) no puede gestionar a Luis, porque Luis no está en su subárbol. Ana tampoco puede gestionar a Pedro: mismo rango. La Raíz gestiona a los tres.

### Reglas numeradas

1. **Raíz única.** Índice único parcial: una sola Raíz activa por organización.
2. **Matriz de creación.** La tabla anterior es la única fuente; se valida en el dominio, no en la UI.
3. **Creador y responsable separados.** `created_by` es inmutable y solo sirve para auditoría. `managed_by` define la autoridad y es transferible.
4. **Transferencia de responsable.** La ejecuta alguien que gestiona a T; el nuevo responsable M debe ser el propio actor o estar en su subárbol, y cumplir M.rango < T.rango.
5. **Cambio de rango.** Solo quien gestiona a T. El nuevo rango debe ser mayor que el del actor y respetar la matriz de creación. Bajar el rango de alguien con subordinados se bloquea hasta reasignarlos.
6. **Sin autogestión.** Cada usuario edita su perfil, contraseña, MFA, passkeys y sesiones. Nunca su rango, roles, estado ni responsable.
7. **Bajas con reasignación.** Al desactivar a U, sus subordinados directos pasan al responsable de U en la misma transacción. Si U era Administrador, pasan a la Raíz.
8. **Nunca se borra un usuario.** Estados: `invited`, `active`, `suspended`, `deactivated`. La auditoría conserva su integridad.
9. **Transferencia de Raíz.** La Raíz la inicia hacia un Administrador; ambos se reautentican; espera de 72 horas con aviso a todos los Administradores; cancelable. La Raíz anterior queda como Administrador gestionado por la nueva.
10. **Recuperación de la Raíz.** Al crear la organización se generan códigos de emergencia, impresos y custodiados por dos personas fuera del sistema. Usarlos alerta a todos los Administradores y queda auditado.
11. **Directorio visible, gestión restringida.** Cualquier usuario activo puede buscar nombre y correo de otros usuarios de su organización (para compartir). Ver detalles, roles y actividad requiere poder gestionarlos.

### Gestionar personas no da acceso a secretos

Ningún rango concede acceso automático a credenciales. El acceso a un secreto solo existe por compartición explícita (ver modelo de autorización).

Para que la Raíz conserve control total sin acceso silencioso, existe el **acceso de emergencia**: la Raíz (y los Administradores con el permiso `vault.emergency_access`) pueden concederse acceso VIEW a cualquier cuenta. Exige motivo escrito y reautenticación, dura 1 hora, notifica a los gestores de la cuenta y queda auditado como evento crítico.

Además, la Raíz y los Administradores con `vault.inventory.read` ven el inventario de cuentas (metadatos, nunca secretos) de toda la organización.

### Grupos

- Un grupo pertenece a la organización. Lo crean la Raíz, Administradores o Líderes; el creador queda como gestor.
- Dos papeles en el grupo: **gestor** (rango 0 a 2, puede haber varios) y **miembro** (cualquier rango).
- Un Operador puede estar en varios grupos. No hay grupos anidados en v1.
- Un gestor agrega o quita miembros que él mismo gestiona (regla de gestión). Pertenecer a un grupo no da autoridad sobre las personas.
- Un gestor comparte con el grupo solo cuentas sobre las que tiene acceso MANAGE.
- Los grupos no son tenants: comparten organización, catálogo y directorio.

## Modelo de autorización

Toda decisión evalúa tres ejes y se niega por defecto: la jerarquía responde a quién gestionas, los permisos (RBAC) qué acciones puedes hacer, y la compartición (ACL) sobre qué recursos. Una acción sobre un secreto exige el permiso **y** el nivel de compartición; ninguno basta solo.

### Catálogo de permisos

Los permisos viven en código (un `enum` versionado), no en la base de datos. El techo indica el rango máximo que puede tenerlo: un Operador (rango 3) nunca recibe un permiso con techo 1.

| Permiso | Qué permite | Techo |  |
| --- | --- | --- | --- |
| `org.settings` | Configuración de la organización, transferencia de Raíz | 0 |  |
| `role.manage` | Crear y editar roles personalizados | 1 |  |
| `platform.manage` | Editar el catálogo de plataformas de la organización | 1 |  |
| `vault.inventory.read` | Ver metadatos de todas las cuentas | 1 |  |
| `vault.emergency_access` | Concederse acceso de emergencia | 1 |  |
| `audit.read_all` | Leer toda la auditoría | 1 |  |
| `sso.clients.manage` | Registrar aplicaciones SSO (fase 2) | 1 |  |
| `user.invite` | Invitar usuarios según la matriz de creación | 2 |  |
| `user.update` | Editar perfil y estado de usuarios gestionados | 2 |  |
| `user.change_rank` | Cambiar el rango de usuarios gestionados | 1 |  |
| `user.transfer` | Cambiar el responsable de un usuario | 2 |  |
| `user.deactivate` | Suspender o desactivar usuarios gestionados | 2 |  |
| `role.assign` | Asignar roles a usuarios gestionados | 2 |  |
| `group.create` | Crear grupos | 2 |  |
| `group.manage_members` | Gestionar miembros de grupos que gestiona | 2 |  |
| `account.create` | Dar de alta cuentas de plataforma | 3 |  |
| `account.update` | Editar metadatos de cuentas (con EDIT) | 3 |  |
| `account.archive` | Archivar cuentas (con MANAGE) | 2 |  |
| `credential.create` | Crear credenciales en cuentas (con EDIT) | 3 |  |
| `credential.update` | Cambiar contraseñas y secretos (con EDIT) | 3 |  |
| `credential.reveal_password` | Revelar la contraseña (con VIEW) | 3 |  |
| `credential.use_totp` | Obtener el código 2FA actual (con USE) | 3 |  |
| `credential.export_totp` | Exportar el secreto 2FA (con MANAGE) | 2 |  |
| `share.manage` | Compartir y revocar (con MANAGE) | 3 |  |
| `access_request.approve` | Aprobar solicitudes de acceso temporal | 2 |  |
| `rotation.manage` | Gestionar tareas de rotación | 2 |  |
| `audit.read_scope` | Leer auditoría de su subárbol y sus recursos | 2 |  |

### Roles

- **Plantillas del sistema** (no editables): Raíz (todo), Administrador (todo salvo `org.settings`), Líder y Operador con conjuntos por defecto. Se definen en código y se versionan.
- **Roles personalizados**: los crea quien tenga `role.manage`. Sus permisos deben ser un subconjunto de los de su creador.
- **No escalamiento**: al asignar un rol a T, el actor debe gestionar a T, tener todos los permisos del rol, y ningún permiso del rol puede superar el techo del rango de T.
- Los permisos efectivos de un usuario son la unión de sus roles, recortada por el techo de su rango. El recorte se recalcula al cambiar el rango.

### Niveles de compartición

| Nivel | Incluye |
| --- | --- |
| USE | Ver metadatos, copiar el usuario, obtener el código 2FA actual, usar el futuro broker de sesiones (nunca ve la contraseña) |
| VIEW | USE + revelar y copiar la contraseña |
| EDIT | VIEW + editar la cuenta y cambiar credenciales |
| MANAGE | EDIT + compartir, revocar, exportar el secreto 2FA, archivar |

- Se comparte con usuarios o grupos. El nivel efectivo es el máximo entre lo directo y lo heredado por grupos.
- Una compartición puede tener `expires_at`; un job las vence y el motor también las ignora al evaluar.
- Nadie comparte un nivel superior al suyo sobre ese recurso.
- Revocar es inmediato; si el usuario reveló la contraseña antes, se genera una tarea de rotación (ver gobernanza).

### Motor de decisión

```
autorizar(contexto, accion, recurso) → Decision {
  permitido: boolean
  motivo: CodigoMotivo          // estable, auditable, traducible
  obligaciones: [REAUTH, MOTIVO_ESCRITO, AUDITORIA_CRITICA]
}

1. Organización del recurso = organización del contexto      si no → DENY TENANT
2. Actor activo y sesión válida                               si no → DENY SESSION
3. Permiso de la acción ∈ permisos efectivos                  si no → DENY PERMISSION
4. Si el recurso es un usuario: puedeGestionar(actor, objetivo) si no → DENY HIERARCHY
5. Si el recurso es de la bóveda: nivel efectivo ≥ requerido  si no → DENY SHARE
6. Restricciones de contexto (reautenticación reciente, ventana JIT, rate limit)
7. ALLOW con obligaciones
```

- **Dos puntos de control**: un guard en el controlador verifica el permiso (paso 3) y el caso de uso llama al motor completo. El guard es una red de seguridad, no la autorización.
- **Los listados filtran en SQL**: una vista `effective_access` (directo + grupos, sin vencidos) se une en cada consulta de listado. Nunca se cargan registros para filtrarlos en memoria.
- **Las negaciones también se auditan**, con su código de motivo. Un patrón de negaciones repetidas es una señal de abuso.
- **Acciones que exigen reautenticación** (válida 5 minutos): revelar contraseña, exportar secreto 2FA, cambiar rango o roles, acceso de emergencia, transferir Raíz, gestionar SSO.
- **Acciones que exigen motivo escrito**: revelar contraseña, exportar secreto 2FA, acceso de emergencia.

## Modelo de dominio y de datos

El dominio separa cinco conceptos que el negocio llamaba "cuenta": la plataforma (Instagram), la cuenta (@marca\_mx en Instagram), la credencial (un acceso a esa cuenta), el secreto (contraseña, TOTP, códigos de recuperación) y la compartición. Una cuenta puede tener varias credenciales.

### Convenciones de todas las tablas

- `id uuid` en formato **UUIDv7**: ordenable por tiempo, buena localidad en índices, no expone conteos.
- `organization_id uuid not null` con RLS (salvo `organizations` y el catálogo global).
- `created_at`, `updated_at` en `timestamptz` (UTC); `created_by` donde aplique.
- Bajas lógicas (`status` o `archived_at`); nada del dominio se borra físicamente, salvo datos efímeros con TTL.
- Concurrencia optimista con columna `version int` en agregados editables.
- Nombres en inglés, `snake_case` en SQL, `camelCase` en TypeScript.

### Tablas de la fase 1

| Módulo | Tabla | Columnas clave |
| --- | --- | --- |
| Organización | `organizations` | name, slug, status, settings jsonb, default\_locale |
| Identidad | `users` | email (único), display\_name, rank, status, managed\_by, created\_by, locale, timezone, last\_login\_at |
| Identidad | `user_passwords` | user\_id, argon2\_hash, changed\_at, must\_change |
| Identidad | `webauthn_credentials` | user\_id, credential\_id, public\_key, sign\_count, transports, name, last\_used\_at |
| Identidad | `user_totp_factors` | user\_id, secret\_ciphertext, verified\_at (MFA del propio sistema) |
| Identidad | `user_recovery_codes` | user\_id, code\_hash, used\_at |
| Identidad | `sessions` | user\_id, token\_hash, ip, user\_agent, mfa\_at, reauth\_at, expires\_at, revoked\_at |
| Identidad | `invitations` | email, rank, invited\_by, token\_hash, expires\_at, accepted\_at |
| Directorio | `groups` | name, description, created\_by, archived\_at |
| Directorio | `group_memberships` | group\_id, user\_id, role (manager/member), added\_by |
| Acceso | `roles` | name, is\_system, permissions text\[\], created\_by |
| Acceso | `user_roles` | user\_id, role\_id, granted\_by |
| Bóveda | `platforms` | organization\_id nullable, name, slug, login\_url, icon, supports\_totp, login\_strategy jsonb, mail\_rules jsonb |
| Bóveda | `accounts` | platform\_id, display\_name, handle, recovery\_email\_alias, owner\_group\_id, tags text\[\], status |
| Bóveda | `credentials` | account\_id, label, kind (password, password\_totp, totp\_only), last\_rotated\_at, health jsonb |
| Bóveda | `credential_secrets` | credential\_id, field, version, ciphertext, nonce, dek\_version, is\_current, created\_by |
| Bóveda | `shares` | resource\_type, resource\_id, grantee\_type (user/group), grantee\_id, level, expires\_at, granted\_by, reason |
| Bóveda | `password_fingerprints` | credential\_id, hmac (detección de reutilización) |
| Gobernanza | `access_requests` | requester\_id, account\_id, level, reason, duration, status, decided\_by |
| Gobernanza | `rotation_tasks` | credential\_id, trigger, triggered\_by\_user, assigned\_to, status, due\_at |
| Gobernanza | `audit_events` | actor\_id, action, target\_type, target\_id, outcome, reason\_code, ip, request\_id, metadata jsonb, prev\_hash, hash |
| 2FA | `totp_handoffs` | user\_id, credential\_id, token\_hash, status, expires\_at, payload\_ciphertext |
| Cripto | `data_keys` | version, wrapped\_dek, kms\_key\_ref, status (active/retired), created\_at |
| Infra | `outbox_events` | aggregate, type, payload, published\_at |
| Infra | `idempotency_keys` | key, actor\_id, request\_hash, response, expires\_at |

### Campos cifrados

`credential_secrets.field` admite: `username`, `password`, `totp_uri`, `recovery_codes`, `secret_notes`. Todo va cifrado, incluido el usuario de la plataforma: en redes sociales, el usuario y el correo de recuperación son la mitad del ataque. Para buscar por usuario exacto se guarda un índice ciego (HMAC con clave por organización), nunca el texto.

El `handle` público (@marca\_mx) y el nombre visible sí van en claro, porque se buscan y se muestran en listados.

### Versionado de secretos

Cada cambio inserta una versión nueva y marca la anterior `is_current = false`. Las versiones anteriores se conservan 30 días (configurable) para recuperar una rotación fallida; luego un job las destruye. Restaurar una versión anterior es una acción auditada que exige EDIT.

### Tablas reservadas para fases futuras

Se documentan ahora para que los nombres y relaciones no choquen después: `oidc_clients`, `oidc_grants`, `signing_keys`, `saml_service_providers`, `scim_targets`, `federated_identities`, `mailboxes`, `mail_aliases`, `inbound_messages`, `extracted_codes`, `sms_numbers`, `broker_sessions`, `login_intents`.

## Diseño criptográfico: KMS, cifrado de sobre y caché

Tres niveles de clave: una clave maestra por organización que nunca sale del KMS (KEK), una clave de datos por organización y versión (DEK) guardada cifrada en `data_keys`, y el cifrado AES-256-GCM de cada secreto con esa DEK. El KMS solo se llama para abrir una DEK, y la DEK abierta vive en memoria con TTL; así el costo del KMS no crece con el número de secretos ni de usuarios.

### Jerarquía de claves

1. **KEK**: una clave simétrica en el KMS por organización, con rotación automática anual del proveedor. Solo el rol IAM del servicio puede usarla para `Decrypt` y `GenerateDataKey`.
2. **DEK**: generada con `GenerateDataKey`. Se guarda solo la versión cifrada (`wrapped_dek`). Una activa por organización; las anteriores quedan `retired` para descifrar.
3. **Secreto**: cifrado con la DEK activa.

### Formato de cada secreto

- Algoritmo AES-256-GCM, nonce aleatorio de 12 bytes por operación (nunca reutilizado), tag de 16 bytes.
- **AAD (datos asociados)**: `org_id | credential_id | field | version`. Si alguien con acceso a la base de datos copia el texto cifrado de una credencial a otra, el descifrado falla. Sin AAD, un atacante podría hacer que el sistema le revele un secreto ajeno a través de un registro al que sí tiene acceso.
- Se guarda `dek_version` junto al texto cifrado para saber con qué DEK abrirlo.
- Un único servicio, `SecretCipher`, en el módulo crypto, cifra y descifra. Ningún otro módulo importa `node:crypto` (regla de lint).

### Caché de DEK

- Caché LRU **en el proceso**, clave = (organización, versión de DEK), valor = DEK en un `Buffer`.
- TTL de 10 minutos y límite de 10 000 usos por entrada; lo que ocurra primero la expulsa.
- Al expulsar, el `Buffer` se sobrescribe con ceros (mejor esfuerzo; Node no garantiza borrado de memoria, por eso el TTL es corto).
- **Nunca** en Redis, en disco, en logs ni en volcados de error. Un `Buffer` con DEK nunca se serializa.
- Peticiones concurrentes por la misma DEK expirada comparten una sola llamada al KMS (single-flight).
- Si el KMS no responde, las DEK en caché siguen sirviendo hasta su TTL; después, el sistema falla cerrado para descifrar, pero sigue funcionando en todo lo que no toca secretos.

### Cuánto se llama al KMS

Llamadas por hora ≈ instancias × organizaciones × versiones de DEK en uso × (60 / TTL en minutos). Con 3 instancias, 1 organización, 1 versión activa y TTL de 10 minutos: unas 18 llamadas por hora, alrededor de 13 000 al mes. A precios aproximados de AWS KMS (del orden de 1 USD por clave al mes y unos centavos por cada 10 000 solicitudes; verificar tarifa vigente), el costo es marginal. Sin caché serían una llamada por secreto revelado o código generado.

### Rotación

- **KEK**: automática anual por el KMS; no requiere recifrar nada.
- **DEK**: trimestral, o inmediata ante un incidente. Se genera una versión nueva y un job de BullMQ recifra los secretos por lotes, con checkpoints y reintentos; durante el proceso conviven ambas versiones.
- **Clave del índice ciego y huellas de contraseña**: derivadas de la DEK con HKDF y una etiqueta por uso, para no mezclar propósitos de clave.

### Otros secretos del sistema

- Contraseñas de usuarios del sistema: Argon2id, nunca cifradas (son hashes).
- Tokens de sesión, invitación y handoff: 256 bits aleatorios; en base de datos solo su SHA-256.
- Secretos TOTP del MFA del propio sistema: cifrados con el mismo `SecretCipher`.
- Credenciales de infraestructura (base de datos, Redis, proveedores): en el gestor de secretos de la nube, inyectadas al arrancar; nunca en el repositorio ni en variables de entorno de archivos.

### Desarrollo local

Un adaptador `LocalKeyManagement` con una clave en un archivo ignorado por git. El servicio **se niega a arrancar** con ese adaptador si `NODE_ENV=production`. Las pruebas usan un adaptador falso determinista.

### Respaldo de claves

Si se pierde la KEK, se pierden todos los secretos. Se requiere: protección contra borrado en la KEK (ventana de espera de 30 días del KMS), alertas ante cualquier solicitud de borrado o deshabilitación, y un simulacro trimestral de restauración completa en un entorno aislado.

## Autenticación del propio sistema

El sistema protege el 2FA de toda la organización, así que su propio login debe ser el más fuerte de todos: MFA obligatorio desde la primera sesión, passkeys como método preferido y sesiones de servidor revocables al instante.

### Alta de usuarios: siempre por invitación

1. Un actor con `user.invite` crea la invitación (correo, rango, responsable, roles). Se valida la matriz de creación y el no escalamiento.
2. Se envía un enlace de un solo uso, vigente 72 horas. El token en base de datos es su hash.
3. El invitado define su contraseña y registra **obligatoriamente** un segundo factor (passkey o TOTP) antes de entrar.
4. Se generan 10 códigos de recuperación de un solo uso; se muestran una vez.

Quien invita nunca conoce la contraseña del invitado. Reenviar una invitación invalida la anterior.

### Factores

- **Contraseña**: mínimo 12 caracteres, sin reglas de composición (NIST SP 800-63B), rechazo de contraseñas comunes con una lista local, puntaje zxcvbn mínimo. Argon2id.
- **Passkeys (WebAuthn)**: preferidas; resistentes a phishing. Se permiten varias por usuario con nombre ("Laptop oficina").
- **TOTP**: alternativa para quien no pueda usar passkeys.
- **Códigos de recuperación**: último recurso; usar uno notifica al usuario y a su responsable.
- **Sin SMS ni correo como segundo factor** del propio sistema.
- Política configurable por organización: exigir passkeys para Raíz y Administradores (recomendado activarlo desde el inicio).

### Sesiones

- Token opaco de 256 bits en cookie `__Host-session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- La web y la API se sirven desde el mismo origen; no hay CORS abierto ni tokens en `localStorage`.
- Expiración por inactividad de 30 minutos y absoluta de 12 horas (configurables por organización).
- El usuario ve y cierra sus sesiones activas; su responsable puede cerrarlas todas.
- Desactivar, suspender, cambiar rango o roles revoca las sesiones del afectado en el acto.
- Protección CSRF: `SameSite` + cabecera personalizada obligatoria en peticiones que modifican (`X-Requested-With`) + verificación de `Origin`.

### Reautenticación (step-up)

Las acciones sensibles listadas en el modelo de autorización exigen haber verificado un factor en los últimos 5 minutos. Se marca `reauth_at` en la sesión. Con passkey es un toque; con TOTP, un código.

### Protección contra ataques

- Rate limiting por cuenta y por IP en login, MFA, recuperación e invitaciones.
- Retraso progresivo tras fallos y bloqueo temporal de la cuenta (no permanente, para evitar bloqueos maliciosos).
- Mensajes de error idénticos para usuario inexistente o contraseña incorrecta; tiempos de respuesta equivalentes.
- Aviso por correo ante login desde un dispositivo nuevo y ante cambios de contraseña o factores.

### Recuperación de acceso

- Con códigos de recuperación: autoservicio, notificado.
- Sin factores: solo su responsable (o la Raíz) puede restablecer los factores, con reautenticación y motivo. El usuario recibe una nueva invitación de configuración; sus comparticiones se conservan.
- La Raíz sin factores: códigos de emergencia custodiados (ver jerarquía).

### Login con proveedores externos

No se usa en la fase 1. El módulo de identidad expone un puerto `ExternalIdentityProvider` para conectar después Google Workspace o Microsoft 365 como fuente de login, si la organización los adopta.

## Bóveda: plataformas, cuentas, credenciales y compartición

La bóveda guarda cuentas de cualquier plataforma, no solo redes sociales: el catálogo de plataformas es datos, no código. Los secretos solo se descifran en tres momentos auditados: revelar, generar un código 2FA y (en el futuro) inyectar en una sesión.

### Catálogo de plataformas

- Catálogo global sembrado por migración (Instagram, Facebook, TikTok, YouTube/Google, X, LinkedIn, Pinterest, Threads, Gmail, Outlook) más plataformas propias de la organización.
- Campos para el futuro, ya presentes: `login_strategy` (cómo iniciar sesión: URL, selectores, pasos) y `mail_rules` (remitentes y patrones de códigos). En la fase 1 quedan vacíos.
- Una plataforma "Personalizada" permite dar de alta cualquier sitio con su URL.

### Casos de uso de la fase 1

| Caso de uso | Requiere | Efectos |
| --- | --- | --- |
| Crear cuenta | `account.create` | El creador recibe MANAGE; opcionalmente se asigna a un grupo propietario |
| Editar cuenta | `account.update` + EDIT | Metadatos, etiquetas, grupo propietario |
| Archivar cuenta | `account.archive` + MANAGE | Revoca comparticiones; los secretos se conservan cifrados |
| Crear credencial | `credential.create` + EDIT | Usuario, contraseña, 2FA, códigos de recuperación |
| Cambiar contraseña | `credential.update` + EDIT | Nueva versión; huella de reutilización; fecha de rotación |
| Revelar contraseña | `credential.reveal_password` + VIEW | Reautenticación, motivo, auditoría; la UI la oculta a los 30 s |
| Copiar usuario | USE | Auditoría ligera |
| Obtener código 2FA | `credential.use_totp` + USE | Ver sección 2FA |
| Compartir / revocar | `share.manage` + MANAGE | Revocar tras una revelación crea tarea de rotación |
| Ver historial de versiones | EDIT | Sin revelar contenido; restaurar es una acción aparte |

### Generador de contraseñas

Integrado en la UI y en la API: longitud configurable (por defecto 24), juegos de caracteres, frase de contraseña opcional. Usa `crypto.getRandomValues` en el navegador; el servidor solo recibe el resultado al guardar. Algunas plataformas limitan longitud o símbolos: el catálogo guarda esas restricciones por plataforma.

### Reglas de revelación en la interfaz

- El secreto nunca viene en listados ni en el detalle; solo en una respuesta dedicada a la acción de revelar, con `Cache-Control: no-store`.
- Se muestra oculto por defecto y se vuelve a ocultar a los 30 segundos.
- Al copiar, el portapapeles se limpia a los 30 segundos (mejor esfuerzo: el navegador puede impedirlo, y los gestores de portapapeles del sistema operativo pueden retenerlo).
- Límite configurable de revelaciones por usuario y hora (por defecto 30); superarlo bloquea la acción y alerta.

### Búsqueda y organización

Búsqueda por nombre visible, handle, plataforma, etiquetas y grupo, siempre filtrada por acceso efectivo en SQL. Búsqueda exacta por usuario de la plataforma mediante índice ciego. Vistas guardadas por usuario ("Mis cuentas", "Sin 2FA", "Por rotar").

### Importación

Importación CSV con previsualización y validación (fase 1, al final). El archivo se procesa en memoria y nunca se guarda. Formatos de exportación de otros gestores: fase posterior.

## 2FA/TOTP: registro y generación de códigos

Los cinco métodos de registro están disponibles siempre y el usuario elige; todos terminan en el mismo caso de uso, `RegisterTotpSecret`, con la misma validación y la misma confirmación. El secreto se guarda cifrado y los códigos se generan en el servidor: el navegador recibe 6 dígitos, nunca el secreto.

### Métodos de registro

| Método | Cómo funciona | Cuándo conviene |
| --- | --- | --- |
| 1. Captura de pestaña | El navegador pide permiso para capturar la pestaña de la plataforma (`getDisplayMedia`), toma un fotograma, decodifica el QR localmente y descarta la captura | Escritorio; el método destacado en la UI |
| 2. Imagen | El usuario pega (Ctrl+V) o sube una captura del QR; se decodifica en el navegador | Cuando la captura de pestaña no está disponible |
| 3. Clave manual | El usuario pega la clave Base32 o la URI `otpauth://` | Cuando la plataforma ofrece "¿no puedes escanear?" |
| 4. Celular | Handoff con la cámara del teléfono (flujo abajo) | Pantallas sin permiso de captura o preferencia del usuario |
| 5. Importar | URI de exportación de Google Authenticator (`otpauth-migration://`) o archivo de otros autenticadores | Migrar 2FA que hoy vive en teléfonos personales |

El QR decodificado nunca se sube como imagen: al servidor solo llega la URI ya extraída, por TLS.

### Validación de la URI

- Tipo `totp` (HOTP se rechaza en v1 con mensaje claro).
- Algoritmo SHA1, SHA256 o SHA512; dígitos 6 u 8; periodo 30 o 60. Valores por defecto según la especificación cuando faltan.
- Secreto Base32 válido de al menos 128 bits; se normalizan espacios y mayúsculas.
- Se muestran emisor y etiqueta para que el usuario confirme que es la cuenta correcta.

### Confirmación obligatoria

1. Tras registrar, el sistema muestra el código actual.
2. El usuario lo introduce en la plataforma para terminar de activar su 2FA.
3. El usuario confirma en el sistema que la plataforma lo aceptó. Solo entonces el secreto pasa a `verified`.
4. Un secreto `pending` no verificado en 24 horas genera un aviso: puede ser una cuenta a punto de quedar bloqueada.

### Flujo con celular (handoff)

1. En el escritorio, el usuario elige "Usar mi celular" para una credencial concreta. Requiere sesión activa y EDIT.
2. El servidor crea un handoff: token aleatorio de 256 bits (se guarda su hash), un solo uso, vigencia de 5 minutos, ligado al usuario y a la credencial.
3. El escritorio muestra un QR con la URL del handoff. El enlace nunca se envía por correo ni chat.
4. El celular abre una página web ligera (sin app nativa) que usa la cámara (`getUserMedia`, requiere HTTPS) y decodifica el QR de la plataforma.
5. El celular envía la URI al endpoint del handoff. El token solo autoriza esa acción, una vez. La página borra su estado.
6. El escritorio recibe un evento (SSE) y muestra emisor y etiqueta. **El usuario confirma en el escritorio** antes de guardar. Esto evita que alguien que fotografió el QR del handoff inyecte un secreto propio.
7. Sigue la confirmación obligatoria con la plataforma.

### Generación de códigos

- Endpoint `POST /credentials/:id/totp-code` → `{ code, expiresIn, nextCode? }`. Se incluye el siguiente código si faltan menos de 5 segundos.
- Requiere USE y `credential.use_totp`. Rate limit por usuario y credencial.
- Auditoría de cada código emitido (evento ligero, agrupable en reportes).
- Los servidores sincronizan hora con NTP; se monitorea la deriva y se alerta si supera 2 segundos.

### Exportar el secreto

Requiere MANAGE, `credential.export_totp`, reautenticación y motivo. Muestra el QR y la clave una vez, crea un evento de auditoría crítico y marca la credencial como "secreto expuesto" en su salud.

### Cambiar o retirar el 2FA

Re-registrar crea una versión nueva; la anterior se conserva 30 días por si la plataforma no aceptó el cambio. Retirar el 2FA de una cuenta exige EDIT y queda marcado en la salud de la credencial.

## Gobernanza: auditoría, bajas, salud y acceso temporal

Estas cuatro capacidades son las que convierten el sistema en algo mejor que una hoja de cálculo con contraseñas: saber quién accedió a qué, cerrar el acceso de quien se va, ver el riesgo acumulado y reducir el acceso permanente.

### Auditoría

- Tabla `audit_events` append-only: el rol de la aplicación solo tiene `INSERT` y `SELECT`; `UPDATE` y `DELETE` revocados.
- **Encadenamiento**: cada evento guarda el hash del anterior de su organización. Un job diario verifica la cadena y alerta si se rompe. Escritura serializada por organización mediante un advisory lock para no bifurcar la cadena.
- Se escribe en la **misma transacción** que la acción. Si la auditoría falla, la acción sensible falla (falla cerrada).
- Nunca contiene secretos, ni siquiera parciales. `metadata` pasa por una lista blanca de campos.
- Se auditan también las negaciones, con su código de motivo.
- Exportación periódica a almacenamiento inmutable (por ejemplo, S3 con Object Lock) para que ni un administrador de base de datos pueda reescribir la historia.
- Retención: 2 años en línea, más en el archivo (ajustar a requisitos legales).
- UI: línea de tiempo por usuario, por cuenta y por credencial, con filtros y exportación CSV.

Eventos críticos que notifican en tiempo real a la Raíz y a los gestores del recurso: acceso de emergencia, exportación de secreto 2FA, transferencia de Raíz, uso de códigos de emergencia, ruptura de la cadena de auditoría, superar el límite de revelaciones.

### Bajas con rotación

Al desactivar a un usuario, el caso de uso `DeactivateUser` ejecuta en una transacción:

1. Revoca todas sus sesiones.
2. Reasigna sus subordinados directos (regla 7 de jerarquía).
3. Elimina sus comparticiones directas y lo saca de todos los grupos.
4. Calcula su **exposición**: credenciales cuya contraseña reveló y secretos 2FA que exportó, consultando la auditoría de los últimos 180 días.
5. Crea una tarea de rotación por cada credencial expuesta, asignada al gestor de la cuenta, con prioridad según el tipo de exposición.
6. Emite un evento de auditoría crítico con el resumen.

El panel de rotaciones muestra tareas pendientes, vencidas y completadas. Una tarea se cierra cuando se registra una nueva versión del secreto. Los mismos disparadores aplican al revocar una compartición tras una revelación.

### Salud de credenciales

Calculada al escribir (cuando el servidor tiene el texto plano) y guardada como puntaje, nunca el secreto:

- Contraseña débil (zxcvbn) o reutilizada (comparación de huellas HMAC, nunca de texto).
- Antigüedad mayor a la política de la organización.
- Cuenta sin 2FA, o 2FA `pending` sin verificar.
- Secreto 2FA exportado alguna vez.
- Correo de recuperación fuera de los dominios propios.
- Rotación pendiente.

Un panel de salud por organización, grupo y cuenta prioriza qué atender primero.

### Acceso temporal (JIT)

1. Un usuario solicita un nivel de acceso a una cuenta, con motivo y duración (máximo configurable, por defecto 8 horas).
2. Pueden aprobar quienes tengan MANAGE sobre la cuenta y `access_request.approve`.
3. Al aprobar se crea una compartición con `expires_at`. Un job la retira al vencer y el motor de autorización también la ignora.
4. Solicitud, decisión, uso y vencimiento quedan auditados.

Con JIT, la recomendación operativa es que los Operadores tengan acceso permanente solo a lo diario, y pidan el resto por tiempo limitado.

## API y contratos

REST con JSON bajo `/api/v1`, contratos definidos con Zod en un paquete compartido y OpenAPI generado de ellos. La API es primero interna (la usa la SPA), pero se diseña como si fuera pública: la futura extensión de navegador y las integraciones la consumirán.

### Convenciones

- Recursos en plural y en inglés: `/users`, `/groups`, `/accounts`, `/credentials`, `/shares`, `/access-requests`, `/audit-events`.
- Acciones que no son CRUD como sub-recursos con verbo: `POST /credentials/:id/reveal`, `POST /credentials/:id/totp-code`, `POST /users/:id/deactivate`, `POST /auth/reauth`.
- Paginación por cursor (`?cursor=&limit=`), nunca por offset en listados grandes.
- Filtros explícitos y en lista blanca; ordenamiento solo por campos indexados.
- Fechas en ISO 8601 UTC. La conversión a la zona del usuario ocurre en la UI.
- `Idempotency-Key` obligatorio en `POST` que crean recursos; se guarda la respuesta 24 horas.
- Concurrencia optimista: `If-Match` con la versión del recurso en `PATCH`; `409` si cambió.
- Cada respuesta lleva `X-Request-Id`; los logs y la auditoría usan el mismo identificador.

### Errores (RFC 9457, Problem Details)

```json
{
  "type": "https://errors.internal/authz/hierarchy",
  "title": "Not allowed to manage this user",
  "status": 403,
  "code": "AUTHZ.HIERARCHY.NOT_IN_SUBTREE",
  "requestId": "01J…"
}
```

- `code` es estable y es la clave de traducción en la UI. Se documenta en un catálogo versionado.
- Nunca se filtran detalles internos (SQL, rutas, trazas). En `404` frente a `403`: si el usuario no debe saber que el recurso existe, se responde `404`.
- Validación con `422` y la lista de campos inválidos.

### Eventos en tiempo real

Server-Sent Events en `/api/v1/events` para notificaciones, handoff de 2FA y cambios en recursos compartidos. Más simple que WebSockets y suficiente para tráfico servidor → cliente.

### Versionado

Cambios compatibles dentro de `v1`. Un cambio incompatible crea `v2` del recurso afectado, con convivencia de al menos un ciclo de despliegue. El cliente web y la API se despliegan juntos, así que la presión de compatibilidad viene sobre todo de la futura extensión.

## Frontend, i18n y modo oscuro

Una SPA en React servida desde el mismo origen que la API, con tema oscuro único definido por tokens y textos en español e inglés desde la primera pantalla. La seguridad del navegador se trata como parte del producto, no como configuración posterior.

### Estructura

- Organización por funcionalidad (`features/vault`, `features/directory`, `features/auth`), no por tipo de archivo.
- TanStack Query para estado del servidor; estado local con hooks. Sin store global salvo necesidad demostrada.
- Los esquemas Zod y tipos vienen del paquete `contracts`; el frontend nunca redefine un contrato.
- La UI oculta lo que el usuario no puede hacer (según permisos que entrega `/me`), pero **nunca es la autorización**: el backend decide siempre.

### Internacionalización

- i18next con espacios de nombres por funcionalidad; claves semánticas (`vault.reveal.confirmTitle`), nunca el texto en inglés como clave.
- Idiomas iniciales `es-MX` y `en-US`; idioma por usuario guardado en su perfil, con detección del navegador solo en el primer acceso.
- Plurales y variables con ICU. Fechas, números y horas con `Intl` en la zona horaria del usuario.
- Los códigos de error de la API se traducen en la UI. Los correos (invitaciones, alertas) se traducen en el backend con el idioma del destinatario.
- Una prueba de CI falla si una clave existe en un idioma y falta en el otro.

### Modo oscuro único

- Tokens de diseño en CSS (superficies, texto, bordes, estados, foco) con un solo juego de valores oscuros. Tailwind consume los tokens.
- Contraste mínimo WCAG AA (4.5:1 en texto normal), verificado con una prueba automática sobre los tokens. Cuidado especial con textos secundarios y deshabilitados.
- `color-scheme: dark` para que controles nativos, barras de desplazamiento y autocompletado del navegador sean oscuros.
- Colores de estado (éxito, alerta, crítico) que no dependan solo del color: siempre con ícono o texto.

### Seguridad en el navegador

- CSP estricta: sin `unsafe-inline` ni `unsafe-eval`, scripts solo del propio origen, `frame-ancestors 'none'` (contra clickjacking), `connect-src` limitado al origen.
- Trusted Types activado para prevenir XSS por DOM.
- Ningún secreto ni token en `localStorage`, `sessionStorage` ni IndexedDB.
- Los secretos revelados viven solo en el estado del componente que los muestra y se descartan al ocultarlos o al desmontar.
- Cierre de sesión por inactividad sincronizado entre pestañas (`BroadcastChannel`).
- Dependencias del frontend con el mismo control que el backend: un paquete comprometido en la SPA ve todo lo que el usuario revela.

### Accesibilidad

Navegación completa por teclado, foco visible, etiquetas en todos los controles y anuncios para lectores de pantalla en acciones como "contraseña copiada". Las primitivas Radix resuelven la mayoría de estos casos.

## Hoja de ruta SSO y preparación del broker tipo Cerby

El orden es OIDC, luego SAML con SCIM, y al final el broker de sesiones: cada paso reutiliza la identidad, los permisos y la auditoría del anterior, y el más frágil queda al final. Las redes sociales casi no aceptan SSO externo; la excepción relevante es Meta (managed Meta accounts), que exige SAML.

### Fase 2: proveedor OpenID Connect

- Motor: `oidc-provider`, con adaptadores propios sobre PostgreSQL y las pantallas de login, MFA y consentimiento hechas por nosotros (reutilizan el módulo de identidad).
- Flujos: Authorization Code + PKCE obligatorio para todos los clientes; refresh tokens con rotación y detección de reuso; Client Credentials para servicios.
- No se habilitan flujos inseguros: sin implicit, sin password grant.
- `redirect_uri` con coincidencia exacta; registro de clientes solo por administradores (`sso.clients.manage`), sin registro dinámico.
- Claves de firma (ES256 o RS256) generadas por el sistema, guardadas cifradas, publicadas en JWKS y rotadas cada 90 días con superposición.
- Claims: `sub`, `email`, `name`, `groups`, `roles` y un claim de rango, con mapeo configurable por cliente.
- Logout: RP-initiated y back-channel, para que desactivar a alguien cierre sus sesiones en las apps conectadas.
- Casos de uso: herramientas internas (Grafana, paneles propios) y SaaS que acepten OIDC.

### Fase 3: SAML 2.0 y SCIM

- SAML IdP con `samlify`, metadatos por proveedor de servicio, aserciones firmadas, opcionalmente cifradas. Revisión de seguridad dedicada: las implementaciones SAML tienen historial de fallas en validación de firmas XML y entidades externas.
- **Objetivo principal: managed Meta accounts.** Login de los empleados a Meta Business Suite con SSO desde nuestro sistema, de modo que desactivar a alguien aquí le quite el acceso a páginas, anuncios e Instagram del Business Portfolio.
- **SCIM 2.0 como cliente**: nuestro sistema aprovisiona y desaprovisiona usuarios en los SaaS que lo soporten. Cola de sincronización con reintentos y reconciliación periódica.
- Antes de iniciar esta fase, confirmar la elegibilidad de la organización para managed Meta accounts.

### Fase final: broker de sesiones (tipo Cerby)

Objetivo: que un usuario con nivel USE inicie sesión en una plataforma sin ver la contraseña. Hay dos enfoques, ambos frágiles:

- **Extensión de navegador** (Manifest V3): recibe del servidor una "intención de login" de corta vida, rellena el formulario y el código 2FA. Limitación honesta: un usuario decidido puede leer lo que la extensión inyecta con las herramientas de desarrollador. Protege contra la exposición casual, no contra un usuario malicioso con acceso.
- **Navegador en el servidor**: un navegador headless inicia sesión y transfiere la sesión al usuario. Más control, pero choca con las protecciones anti-bot de las plataformas, puede violar sus términos de uso y dispara bloqueos por cambio de dispositivo o IP.

La rotación automática de contraseñas (otra pieza de Cerby) depende de los mismos mecanismos y comparte su fragilidad.

### Lo que se deja preparado desde la fase 1

1. **Nivel USE ya excluye revelar**: el modelo de permisos soporta "usar sin ver" desde el inicio.
2. **Propósito de uso del secreto**: `SecretAccessPurpose = REVEAL | TOTP_CODE | EXPORT | INJECT`. Toda lectura de un secreto declara su propósito, se autoriza y se audita por propósito. `INJECT` existe en el enum y está deshabilitado.
3. **Puertos definidos sin adaptador**: `LoginStrategyPort` (cómo iniciar sesión en una plataforma), `SessionBrokerPort` (entregar una sesión), `PasswordRotationPort` (cambiar la contraseña en la plataforma).
4. **Catálogo con `login_strategy`**: esquema JSON versionado (URL, pasos, selectores, tipo de 2FA), validado con Zod aunque esté vacío.
5. **Tablas reservadas**: `login_intents`, `broker_sessions`.
6. **Autenticación de dispositivos**: el módulo de identidad contempla un tipo de sesión `device` (para la extensión) con tokens ligados al dispositivo, aunque no se emitan todavía.
7. **Acciones de auditoría reservadas**: `credential.injected`, `broker.session.started`, `credential.rotated_by_system`.

## Preparación para lectura de correos y SMS

Con dominios propios, la lectura de códigos no necesita leer bandejas de Gmail ni pasar evaluaciones de Google: el correo llega directo a nuestra infraestructura. La decisión que se toma ya en la fase 1 es dar a cada cuenta de plataforma su propio alias de correo.

### Decisión inmediata (fase 1)

- Reservar un subdominio solo para esto, por ejemplo `id.dominio.com`, separado del correo de las personas.
- Cada cuenta de plataforma recibe un alias único: `ig-marca-mx@id.dominio.com`. El campo `recovery_email_alias` ya existe en `accounts`.
- Mientras la lectura no exista, el subdominio reenvía a un buzón operativo controlado. Así las cuentas se crean desde el día uno con el correo que usarán siempre.
- Configurar SPF, DKIM y DMARC del subdominio desde el inicio.

### Fase 4: ingesta de correos

1. **Recepción**: registros MX del subdominio apuntando a un servicio de correo entrante programable (por ejemplo, AWS SES inbound → S3 → evento, o un servidor SMTP propio). Sin IMAP ni contraseñas de buzones.
2. **Verificación del remitente**: se exige DKIM válido y alineado con el dominio de la plataforma. Sin esto, cualquiera podría enviar un correo falso con un "código" para manipular a un operador.
3. **Asociación**: el alias de destino identifica la cuenta y la organización.
4. **Extracción**: reglas por plataforma en `mail_rules` (remitentes permitidos, asunto, expresión del código). Correos que no coinciden quedan en cuarentena para revisión.
5. **Almacenamiento mínimo**: se guarda el código cifrado con TTL de 10 minutos. El cuerpo del correo se descarta o se guarda cifrado con retención corta solo si se necesita para depurar reglas.
6. **Entrega**: el código aparece en la credencial para quien tenga USE, por SSE, con auditoría.
7. **Aislamiento**: el procesamiento corre en un worker separado. El correo es entrada no confiable: HTML nunca renderizado, adjuntos ignorados, límites de tamaño y tiempo de procesamiento.

Alerta de seguridad: los correos de "restablece tu contraseña" también llegarán aquí. Ver un enlace de restablecimiento equivale a poder tomar la cuenta, así que se exige MANAGE y se audita como evento crítico.

### Fase 5: SMS

- Números virtuales de un proveedor de telefonía con API, uno por cuenta o por grupo de cuentas.
- Limitaciones a validar antes de invertir: varias plataformas rechazan números VoIP para 2FA, y el SMS es el factor más débil (intercambio de SIM, intercepción).
- Recomendación permanente: preferir TOTP siempre que la plataforma lo permita; el SMS solo para plataformas que no ofrezcan otra opción.
- Mismo pipeline que el correo: recepción, asociación, extracción, código cifrado con TTL, auditoría.

## Reglas de código, documentación y desarrollo con IA

Las reglas que importan se hacen cumplir con herramientas, no con buena voluntad: si una regla de arquitectura no tiene un lint o una prueba que la verifique, el asistente de IA (y las personas) la romperán tarde o temprano.

### Capas dentro de cada módulo (hexagonal)

| Capa | Contiene | Puede importar |
| --- | --- | --- |
| `domain` | Entidades, objetos de valor, políticas, eventos de dominio, errores | Solo `domain` del mismo módulo y `shared/kernel`. Nada de NestJS, Drizzle ni Node |
| `application` | Casos de uso (comandos y consultas), puertos (interfaces), DTO internos | `domain` del mismo módulo y fachadas públicas de otros módulos |
| `infrastructure` | Adaptadores: repositorios Drizzle, KMS, Redis, correo | `application` y `domain` del mismo módulo, bibliotecas externas |
| `interface` | Controladores HTTP, SSE, procesadores de colas, mapeo a contratos | `application` del mismo módulo y `contracts` |

- Regla de dependencia verificada por `eslint-plugin-boundaries` y dependency-cruiser en CI.
- **Entre módulos**: solo a través de la fachada pública (`index.ts` del módulo) o de eventos de dominio vía outbox. Ningún módulo lee tablas ni repositorios de otro.
- Un caso de uso = una clase con un método `execute`, un archivo, un nombre en imperativo (`RevealPassword`, `ShareAccount`).
- Comandos y consultas separados (CQRS ligero): los comandos pasan por el dominio; las consultas de listado pueden leer proyecciones SQL directas, siempre con el filtro de acceso.

### TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`.
- Prohibido `any` (lint como error); `unknown` + validación en los bordes.
- Tipos de marca para identificadores (`UserId`, `OrganizationId`, `CredentialId`) para no confundir un id con otro.
- Errores esperados como `Result<T, DomainError>` en dominio y aplicación; excepciones solo para lo inesperado. Un filtro global traduce `DomainError` a Problem Details.
- Nombres en inglés en el código; comentarios y documentación en español.

### Comentarios y documentación

- Los comentarios explican **por qué**, no qué. Si hace falta explicar qué hace el código, el código se renombra o se divide.
- TSDoc obligatorio en puertos, casos de uso y fachadas públicas.
- Todo archivo de los módulos protegidos abre con un bloque `Invariantes de seguridad` que lista lo que nunca debe romperse en ese archivo.
- `docs/adr/`: una decisión por archivo, numerada, con contexto, decisión, alternativas y consecuencias. Las 20 decisiones de este plan son los primeros ADR.
- `README.md` por módulo: responsabilidad, fachada pública, eventos que emite y consume.
- `docs/runbooks/`: procedimientos de operación (rotar DEK, restaurar respaldo, responder a fuga, transferir Raíz).
- `docs/threat-model.md`: modelo de amenazas (STRIDE por módulo), revisado en cada fase.

### Flujo de trabajo

- Trunk-based con ramas de vida corta; Conventional Commits; PR pequeños.
- Plantilla de PR con lista de verificación de seguridad (autorización, auditoría, secretos en logs, filtro de organización, pruebas de matriz).
- Toda PR requiere revisión humana. Las que tocan rutas protegidas requieren dos.
- Rutas protegidas en `CODEOWNERS`: `modules/identity`, `modules/access`, `modules/crypto`, `modules/audit`, migraciones con RLS, configuración de CSP y cabeceras.

### Desarrollo con Claude Code

Un `CLAUDE.md` en la raíz y uno por módulo protegido. Contenido mínimo de la raíz:

```markdown
# Reglas no negociables
- Arquitectura hexagonal: respeta las capas de docs/architecture.md.
- Toda consulta pasa por repositorios con contexto de organización. Nunca SQL sin RLS.
- Todo caso de uso que toca usuarios o bóveda llama a Authorizer.authorize().
- Toda acción sensible escribe auditoría en la misma transacción.
- Criptografía solo vía modules/crypto (SecretCipher). Prohibido importar node:crypto fuera.
- Nunca registres secretos, tokens, cookies ni cuerpos de petición de rutas sensibles.
- No agregues dependencias. Si crees que hace falta una, propónla y detente.
- No edites migraciones ya aplicadas; crea una nueva.
- Nunca leas .env*, secretos ni datos de producción.

# Definición de terminado
- Pruebas unitarias del dominio y de la matriz de autorización si aplica.
- Prueba de integración con PostgreSQL real si toca repositorios.
- Claves i18n en es y en.
- Lint, tipos y pruebas en verde.
```

- Configurar los permisos del agente para denegar lectura de `.env*` y ejecución de comandos de red y de despliegue.
- El código generado en rutas protegidas se revisa línea por línea; "las pruebas pasan" no es criterio suficiente ahí.
- Las pruebas de la matriz de autorización las escribe una persona o se revisan como si fueran código de producción: si la IA escribe el código y sus pruebas, puede codificar el mismo error en ambos.

### Dependencias y cadena de suministro

- Versiones exactas, lockfile obligatorio, `pnpm install --frozen-lockfile` en CI.
- Nueva dependencia: aprobación humana con justificación (mantenimiento, descargas, alternativas, licencia).
- Actualizaciones con Renovate en lotes, con espera de 7 días tras cada publicación antes de adoptarla.
- Scripts de instalación deshabilitados por defecto (`ignore-scripts`), con lista blanca explícita.

## Estrategia de pruebas

La prioridad no es la cobertura total sino probar exhaustivamente lo que, si falla, filtra secretos: autorización, aislamiento entre organizaciones, criptografía y auditoría. Esas cuatro áreas tienen pruebas dedicadas que bloquean el merge.

| Tipo | Herramienta | Qué cubre | Umbral |
| --- | --- | --- | --- |
| Unitarias de dominio | Vitest | Políticas, entidades, reglas de jerarquía, validación de URIs TOTP | 90 % de ramas en módulos protegidos |
| Matriz de autorización | Vitest, tabla generada | Cada combinación actor × rango × relación × acción con su resultado | 100 % de combinaciones definidas |
| Mutación | Stryker | Módulos `access` y `crypto` | Puntaje mínimo 80 % |
| Integración | Vitest + Testcontainers | Repositorios, RLS, transacciones, auditoría, colas | Todos los repositorios |
| Aislamiento de tenants | Testcontainers | Dos organizaciones; ningún cruce de lectura, escritura ni conteo | Cada repositorio y cada endpoint de listado |
| Contrato | Esquemas Zod + OpenAPI | La API cumple sus contratos; sin cambios incompatibles sin versión | Todos los endpoints |
| End-to-end | Playwright | Invitación, login con passkey, compartir, revelar, registrar 2FA, baja con rotación | Flujos críticos |
| Seguridad automatizada | Semgrep, osv-scanner, gitleaks, Trivy, ZAP en staging | SAST, dependencias, secretos, imágenes, DAST | Sin hallazgos altos o críticos |

### Matriz de autorización

Se define como datos: una tabla de casos con actor, objetivo, relación (mismo subárbol o no), acción y resultado esperado. Un generador recorre todas las combinaciones de rango y relación para las acciones de gestión de usuarios, de modo que un caso no previsto aparece como fallo. Cualquier cambio en reglas de jerarquía o permisos actualiza primero la matriz.

### Criptografía

- Vectores conocidos para AES-GCM y TOTP (RFC 6238 publica vectores de prueba).
- Pruebas negativas: AAD alterado, nonce reutilizado, DEK incorrecta, texto cifrado truncado. Todas deben fallar.
- Pruebas de rotación de DEK con datos de ambas versiones conviviendo.

### Auditoría

- Cada caso de uso sensible tiene una prueba que verifica el evento exacto que escribe.
- Prueba de falla cerrada: si la escritura de auditoría falla, la acción no se completa.
- Verificación de la cadena de hashes tras operaciones concurrentes.

### Antes de producción

Pentest externo independiente sobre la fase 1 completa, con alcance explícito: autorización, aislamiento, criptografía, sesiones y flujos de 2FA. No se cargan credenciales reales hasta cerrar los hallazgos altos y críticos. Se repite antes de cada fase de SSO.

## Infraestructura, despliegue y operación

Referencia en AWS con servicios gestionados, porque tres personas no deben operar bases de datos ni KMS propios. El código no depende del proveedor: cada servicio externo está detrás de un puerto, y GCP o Azure tienen equivalentes directos.

### Componentes (referencia AWS)

| Pieza | Servicio | Configuración clave |
| --- | --- | --- |
| API y web | Contenedores en ECS Fargate | Mínimo 2 tareas en zonas distintas; sin acceso SSH |
| Workers | ECS Fargate, servicio separado | Misma imagen, otro punto de entrada |
| Base de datos | RDS PostgreSQL Multi-AZ | Cifrado en reposo, PITR, red privada, TLS obligatorio |
| Redis | ElastiCache | Red privada, TLS y autenticación |
| Claves | KMS | Una KEK por organización; políticas de uso mínimas |
| Secretos de infraestructura | Secrets Manager | Rotación de credenciales de base de datos |
| Entrada | ALB + WAF | TLS 1.2+, reglas administradas, rate limiting de borde |
| Archivo de auditoría | S3 con Object Lock | Modo compliance, retención según política |
| Correo saliente | SES | Invitaciones y alertas; DKIM del dominio |
| Correo entrante (fase 4) | SES inbound | Subdominio dedicado |

La misma imagen de contenedor sirve API, workers y migraciones con distintos comandos de arranque. La SPA se compila y la sirve la API (mismo origen) o un CDN detrás del mismo dominio.

### Entornos

- `local` (Docker Compose: PostgreSQL, Redis, KMS local), `staging` (réplica de producción con datos sintéticos) y `production`.
- Cuentas de AWS separadas para staging y producción. Nadie del equipo tiene acceso de escritura permanente a producción; el acceso se pide con JIT y queda registrado.
- Datos reales nunca fuera de producción.

### CI/CD

1. PR: lint, tipos, unitarias, integración, aislamiento de tenants, matriz de autorización, contrato, SAST, secretos, dependencias.
2. Merge a main: build de la imagen, SBOM, escaneo de imagen, firma de la imagen.
3. Despliegue automático a staging; e2e y DAST.
4. Producción con aprobación manual; despliegue gradual con rollback automático por salud.

Las acciones de CI se fijan por SHA, no por etiqueta. Las credenciales de despliegue son federadas (OIDC del proveedor de CI hacia la nube), sin claves de larga duración.

### Migraciones

- Patrón expandir y contraer: primero se agrega (columna, tabla), se despliega código compatible con ambos estados, y después se elimina lo viejo en otra migración.
- Se ejecutan como paso previo al despliegue, con el rol de migraciones.
- Toda tabla nueva incluye `organization_id`, índice y política RLS en la misma migración; una prueba de CI lo verifica.

### Respaldos y recuperación

- PITR con 35 días de retención y snapshots diarios copiados a otra región.
- Objetivos iniciales: RPO de 5 minutos y RTO de 4 horas (a validar con el negocio).
- **Simulacro trimestral** de restauración completa en una cuenta aislada, incluido descifrar secretos con la KEK. Un respaldo que nunca se restauró no es un respaldo.
- Procedimiento de contingencia si el sistema cae: los códigos de recuperación de las cuentas críticas de plataforma se guardan también fuera del sistema, en sobre sellado.

## Observabilidad y seguridad operativa

Los logs técnicos y la auditoría son cosas distintas: los logs sirven para depurar y se pueden muestrear; la auditoría es evidencia y nunca se pierde. Ninguno de los dos contiene secretos.

### Logs

- `pino` en JSON con `requestId`, `organizationId`, `actorId`, módulo y caso de uso.
- Redacción obligatoria por configuración: `password`, `secret`, `token`, `totp`, `code`, `authorization`, `cookie`, `ciphertext`, `wrapped_dek` y cuerpos de las rutas de revelación, códigos y handoff.
- Una prueba envía secretos conocidos por los endpoints sensibles y verifica que no aparecen en los logs capturados.
- Retención de 30 días en caliente.

### Métricas y trazas

OpenTelemetry para trazas y métricas. Métricas de negocio y seguridad además de las técnicas:

- Logins exitosos y fallidos, reautenticaciones, bloqueos.
- Revelaciones, códigos 2FA emitidos y exportaciones por hora, por usuario y por organización.
- Llamadas al KMS, tasa de aciertos de la caché de DEK, latencia de descifrado.
- Negaciones de autorización por código de motivo.
- Tareas de rotación abiertas y vencidas; secretos 2FA sin verificar.
- Latencia p95 y errores por endpoint.

### Alertas

| Señal | Severidad |
| --- | --- |
| Ruptura de la cadena de auditoría o falla al escribirla | Crítica |
| Solicitud de borrado o deshabilitación de una KEK | Crítica |
| Uso de códigos de emergencia de la Raíz o acceso de emergencia | Crítica |
| Usuario supera el límite de revelaciones | Alta |
| Pico de logins fallidos o de negaciones de autorización | Alta |
| Errores del KMS o caché de DEK sin aciertos | Alta |
| Deriva de reloj mayor a 2 segundos | Media |
| Tareas de rotación vencidas | Media |

### Respuesta a incidentes

Runbooks escritos y ensayados antes de producción:

- **Sospecha de usuario comprometido**: suspender, revocar sesiones, revisar auditoría, rotar todo lo que reveló.
- **Sospecha de servidor comprometido**: rotar DEK, rotar credenciales de infraestructura, revisar uso del KMS en sus registros del proveedor, evaluar rotación masiva de credenciales de plataformas.
- **Fuga de la base de datos sin el KMS**: los secretos siguen protegidos; rotar DEK por precaución y revisar accesos.
- **Caída total**: procedimiento de contingencia con los sobres sellados de recuperación.

### Cumplimiento

Los correos de recuperación, nombres y registros de actividad de los empleados son datos personales. En México aplica la ley de protección de datos personales en posesión de particulares: aviso de privacidad interno para empleados, finalidades del registro de auditoría y periodos de retención documentados. Validar con el área legal antes de producción.

## Registro de riesgos

El riesgo mayor no es técnico sino de alcance: tres personas construyendo a la medida lo que en el mercado son tres productos. La mitigación es entregar por fases usables y no abrir la siguiente hasta cerrar la anterior.

| Riesgo | Tipo | Impacto | Mitigación |
| --- | --- | --- | --- |
| Alcance excesivo; ninguna fase termina con calidad | Proyecto | Producto a medias guardando secretos reales | Fases con criterios de salida; congelar alcance por fase |
| Falla de autorización (IDOR, escalamiento) | Seguridad | Acceso a secretos ajenos | Motor único, matriz exhaustiva, mutación, pentest |
| Fuga entre organizaciones | Seguridad | Exposición cruzada al activar multitenancy | RLS + contexto + AAD por organización + suite de aislamiento |
| Código de seguridad generado por IA con errores sutiles | Seguridad | Vulnerabilidades que pasan las pruebas | CODEOWNERS, revisión doble en rutas protegidas, CLAUDE.md, pruebas escritas por personas |
| Dependencia npm comprometida | Seguridad | Robo de secretos desde API o SPA | Versiones fijas, espera de 7 días, sin scripts de instalación, aprobación humana |
| Pérdida de la KEK o del acceso al KMS | Disponibilidad | Pérdida total de secretos | Protección contra borrado, alertas, simulacros de restauración |
| Servidor comprometido con acceso al KMS | Seguridad | Lectura de todos los secretos | IAM mínimo, red privada, monitoreo de uso del KMS, rotación y runbook |
| Raíz sin acceso o fuera de la organización | Operación | Nadie gestiona Administradores | Códigos de emergencia custodiados, transferencia de Raíz |
| Sistema caído en horario de operación | Disponibilidad | Equipo sin acceso a redes sociales | Multi-AZ, respaldos, sobres de recuperación de cuentas críticas |
| Secretos 2FA mal registrados | Operación | Cuentas bloqueadas | Confirmación obligatoria, versiones anteriores 30 días, alertas de `pending` |
| Abuso interno (un usuario con acceso legítimo copia todo) | Seguridad | Exfiltración silenciosa | Nivel USE sin revelar, límites, motivos, alertas, JIT, rotación en bajas |
| Elegibilidad para managed Meta accounts | Producto | Fase 3 sin su objetivo principal | Confirmar con Meta antes de iniciar la fase |
| Broker frágil ante cambios de las plataformas | Producto | Mantenimiento continuo, bloqueos de cuentas | Dejarlo al final, como opcional, con monitoreo por plataforma |

## Decisiones pendientes del equipo

Ninguna bloquea la fase 0, pero las cuatro primeras deben cerrarse antes de terminarla.

- [ ] **Proveedor de nube**: AWS es la referencia del plan; confirmar o elegir GCP o Azure (define KMS, base de datos gestionada y correo).
- [ ] **Escala esperada el primer año**: usuarios, cuentas de plataforma y revelaciones diarias aproximadas (ajusta límites, TTL de caché y tamaño de instancias).
- [ ] **Disponibilidad requerida**: horario de operación del equipo de redes y tolerancia a caídas (valida RPO de 5 minutos y RTO de 4 horas).
- [ ] **Subdominio para alias de cuentas**: nombre y configuración DNS, para crear las cuentas con su correo definitivo desde el día uno.
- [ ] **Presupuesto de pentest externo** antes de cargar credenciales reales.
- [ ] **Política de retención** de auditoría y versiones de secretos, validada con el área legal.
- [ ] **Exigir passkeys** a Raíz y Administradores desde el inicio (recomendado: sí).
- [ ] **Elegibilidad para managed Meta accounts** (antes de la fase 3).
- [ ] **Custodios** de los códigos de emergencia de la Raíz (dos personas).
