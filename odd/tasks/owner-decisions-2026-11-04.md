# Decisiones del dueño del 2026-11-04: lo que se puede construir

Objetivo: llevar a cabo las tareas que se desprenden de las respuestas del dueño del 2026-11-04. Rama: `main` (autonomía del proyecto). Entrega: un commit por unidad terminada. Pruebas: Vitest (`pnpm --filter @iam/api test:unit` y `test:integration`, con Podman), siempre a través del agente `test-runner`.

## Specs

- **S1. Retención de versiones de contraseña (C9).** El dueño respondió «6.1. Opcion A», que es «30 días» para las versiones viejas de contraseña. `purge-expired` destruye las versiones de `password` reemplazadas hace 30 días o más. Nunca toca la vigente ni los demás campos (usuario, códigos de recuperación, notas), cuya retención no se decidió.
- **S2. Retención de auditoría (ADR 0024).** El dueño respondió «3. Si, no tengo problema con los 2 anios» y «1. Si, mensuales»: el ADR 0024 se ratifica con particionado mensual y la opción 1.
- **S3. Bajas (P1).** El dueño respondió:
  - «4.0. Si, quitar las 2»;
  - «4.1. Opcion B»;
  - «4.2. Opcion A, pero no podriamos asignarlo al admin mas cercano?», confirmado con «2. Si, es correcto, asignar y notificar o si no se puede , tambien alertar»;
  - «4.3. Si»;
  - «4.4. Opcion A»;
  - «4.5. Opcion A».

  Si nadie califica dentro de la rama de quien da la baja, la cuenta va al Administrador más cercano hacia arriba que tenga los permisos y se le notifica; si no hay ninguno, queda sin responsable y se alerta.
- **S4. Transferencia de la Raíz (J3).** El dueño respondió «5.1. Opcion B», «5.2. Opcion A», «5.3. Opcion A», «5.4. Es correcta la opcion A», «5.5. Ambas opciones», «5.6. Opcion A» y «5.7. Opcion A.». El detalle está en `docs/handoff.md` §5.
- **S5. Ancla de auditoría (ADR 0042).** El dueño respondió «2.1. Opcion A», «2.2. Opcion B, una vez al dia» y «2.3. Que se pueda configurar la alerta, en un panel "root" para recibir estas alertas con opciones de "Correo y/o Telegram"».
- **S6. Respaldos (C2 y L2).** El dueño respondió «7.1 Solo la opcion A»: `pg_dump` cada hora, con RPO de 1 h y RTO de 4 h.
- **S7. Documentación de lo decidido.** El dueño respondió «7.3. Opcion A» y «7.2. Si». Se refleja la fase 1a cerrada en lo funcional, el alcance de la prueba de penetración y lo demás en los documentos que lo describen.

## Tasks

| ID | Specs | Ruta | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| T1 | S2, S3, S6, S7 | delegada (redactor de docs, regla del proyecto) | hecha | `e269996` y el commit de docs siguiente: governance §2.4, actors-and-hierarchy fila 8, transfer-root, respaldos (RPO 1 h), roadmap 1a cerrada, handoff |
| T2 | S1 | inline (código y pruebas) | hecha | línea base verde (21 pruebas); después 27 verdes; la rotura intencional (quitar el filtro por campo) la detectan 3 pruebas del bloque C9 |
| T3 | S3 | inline, ruta protegida; 7 commits (L11) | en curso: hechos los commits 1 (docs, `195ba45`), 3 (cadena de superiores, `5984226`) y la regla de elección (L12); hecho el adaptador de bóveda (L13); hecho el comprobador de permisos (L14) , el caso de uso de reasignación (L15) y los adaptadores de limpieza y rotación (L16); (L17: orquestador; L18: lista blanca de auditoría; L19: eventos y correos); faltan eventos y correos, e integración en `deactivate` | cadena: 34 pruebas dirigidas en verde; regla: 10 en verde y la rotura intencional la detectan 2 pruebas |
| T4 | S4 | inline, ruta protegida y migración | pendiente | |
| T5 | S2 | inline, ruta protegida y migración | pendiente: depende de T6 para retirar particiones | |
| T6 | S5 (ancla) | inline, ruta protegida | hecha en código (L7) y alerta a la Raíz si falla (L9); falta que Ops cree y ensaye el bucket real | 37 pruebas dirigidas en verde; mutación (quitar la sobrescritura de `anchored_seq`) detectada por 3 pruebas; commit siguiente a este registro |
| T7 | S5 (panel de alertas) | inline, migración con aislamiento; pantalla con `frontend-developer` | hecha: API (L8), productor desde `anchor-audit` (L9) y pantalla `/alerts` (L10) | 73 pruebas dirigidas en verde, más 2 tras la corrección de los jueces; mutación de L8; pantalla: 36 pruebas dirigidas en verde (L10) |

## Log

- L1 (2026-11-04, textual): «1. Si, mensuales 2. Si, es correcto, asignar y notificar o si no se puede , tambien alertar Adelante con llevar a cabo todas las tareas que sean posibles, sin problema puedes llevar a cabo todas las tareas que conllevan o involucren las respuesta brindadas». Las respuestas anteriores del mismo día están en la sección Specs y en el commit `4a5be73`.
- L2 (2026-11-04): el encargo del dueño cubre las rutas protegidas que tocan estas respuestas: bajas (identidad, acceso y bóveda), transferencia de la Raíz (identidad) y auditoría. Las pruebas de autorización, aislamiento y criptografía se marcan `SENSIBLE` para revisión humana.
- L3 (2026-11-04): en T2, la aserción de `apps/api/test/purge-expired.integration.test.ts:293` («la purga no toca contraseñas») fijaba el comportamiento anterior y S1 lo cambia por decisión del dueño. Pasa a nivel del almacén de TOTP (la purga de TOTP sigue sin tocar contraseñas) y se agrega un bloque propio para la regla de contraseñas.
- L4 (2026-11-04): T2 terminada. Un solo SQL compartido (`purge-replaced-secret-versions.ts`) que recibe el campo; almacenes para `totp_uri` y `password`. Formato, tipos y lint en verde; pruebas dirigidas por `test-runner`: 27 verdes. Las pruebas del bloque C9 quedan marcadas `SENSIBLE` para revisión humana.
- L5 (2026-11-04): T1 terminada. Mapa de T3, hecho por un explorador de solo lectura:
  - la baja actual (`ManageUsers.deactivate`, `apps/api/src/modules/directory/application/manage-users.ts:158`) no toca comparticiones ni crea tareas de rotación;
  - tampoco saca a la persona de sus grupos, aunque el comentario de `db/migrations/0004_directory_access.sql:27` lo afirma;
  - no existe ayuda para subir por la cadena ni para calcular los permisos de un usuario arbitrario;
  - las tareas de rotación (`rotation_tasks`) exigen asignatario y deduplican en código.

  T3 es grande (varias sesiones): toca directorio, bóveda y acceso, notificación con plantilla en dos idiomas, informe de baja y jueces.
- L6 (2026-11-04, textual): «Adelante con esa libreria, sin problema Y si, una tabla nueva, seria lo mejor para las alertas». Se aprueba `@aws-sdk/client-s3` (versión exacta, con al menos 7 días de publicada) para el ancla en Wasabi, y una tabla nueva de ajustes del sistema para las preferencias de alerta de la Raíz.
- L7 (2026-11-04): T6 terminada en código.
  - Qué hay:
    - comando diario `anchor-audit` (`apps/api/src/main.anchor-audit.ts`);
    - registro local `audit_anchors` (migración 0033), donde la base asigna número, cabeza y hashes, solo se puede agregar y tiene aislamiento por filas;
    - publicación en Wasabi con `@aws-sdk/client-s3` 3.1155.0, Object Lock en modo de cumplimiento y retención de 2 años de calendario.
  - Jueces ciegos A y B. Lo que confirmaron ambos se corrigió:
    - el hash del manifiesto va en el nombre del objeto (sin él, una base restaurada sobrescribiría con una versión nueva);
    - retención en años de calendario, no 730 días (quedaba un día corto con un 29 de febrero);
    - `lock_timeout` de 5 s al insertar;
    - pruebas nuevas de concurrencia, de fecha falsa sobrescrita y de aislamiento autosuficiente.
  - La suma de verificación que agrega el SDK se conserva, porque Object Lock exige una; el ensayo del runbook confirma que Wasabi la acepta.
  - Señalado por un solo juez, para revisión humana, sin corregir:
    - A: con cero organizaciones termina en 0; un error no capturado se imprime tal cual; la llave foránea impide borrar de verdad una organización.
    - B: el trigger debería validar `app.org_id` antes del bloqueo; usar un rol propio o SECURITY DEFINER para insertar; detectar una cabeza que retrocede; manejadores de error del pool; afirmar `AuditAnchorPublishError` en la prueba de integración.
  - Evidencia:
    - formato, tipos y lint en verde (api y db);
    - pruebas dirigidas por `test-runner`: 37 verdes. La primera corrida falló porque la prueba de concurrencia nueva usaba la organización «vacía»; se le dio la suya y quedó en verde;
    - mutación: quitar `new.anchored_seq := …` del trigger hace fallar 3 pruebas; la migración se restauró y `cmp` confirma que es idéntica.
  - Siguiente paso: T7. Mapa del explorador: `integration.infra_alert` no tiene productor; `NotifyInfrastructureAlert` solo usa Telegram; `organizations.settings` no se usa; existe el permiso `alerts.infra.manage`.
- L8 (2026-11-04): T7, API del panel de alertas de la Raíz.
  - Qué hay:
    - tabla `alert_settings` (migración 0034): una fila por organización, al menos un canal encendido (dominio y `check`), sin borrado, aislamiento por filas;
    - `GET` y `PUT /integrations/alert-settings` con el permiso `alerts.infra.manage` (reautenticación y auditoría crítica del catálogo), versión optimista (`CONFLICT.VERSION`) y error `INTEGRATIONS.ALERT_CHANNEL_REQUIRED` (422);
    - el manejador de `integration.infra_alert` envía por correo a cada Raíz activa, en su idioma, y/o por Telegram, con acuse por destino.
  - Decisiones conservadoras:
    - sin fila rigen correo y Telegram encendidos: conserva el aviso por Telegram que ya existía y suma el correo (ADR 0047);
    - sin ningún destino real, el evento va a cuarentena (`INTEGRATIONS.ALERT_CONFIG_INVALID`, no reintentable) en vez de perderse;
    - la prueba anterior «no hace nada sin canal activo» fijaba el comportamiento previo; cambia por decisión del dueño, porque ahora el correo sale por omisión (mismo criterio que L3).
  - Jueces ciegos A y B. Lo que confirmaron ambos se corrigió: una falla permanente de Telegram mandaba el evento a cuarentena aunque el correo ya hubiera llegado. Ahora solo va a cuarentena si la alerta no llegó a nadie; dos pruebas nuevas lo fijan. La sospecha compartida sobre el cambio de clave de acuse se descartó: en HEAD no había acuses.
  - Señalado por un solo juez, para revisión humana, sin corregir:
    - A: aislar cada canal de excepciones (hoy una excepción en Telegram impide intentar el correo en ese intento); avisar al guardar «solo Telegram» sin chat activo; la etiqueta del permiso todavía dice «(Telegram)».
    - B: tope de `expectedVersion` (un valor mayor que un entero de 32 bits daría 500 en vez de 409); pruebas de la llave foránea de `updated_by` y del UPDATE bajo otra organización.
  - Evidencia: formato, tipos y lint de la API en verde; pruebas dirigidas por `test-runner`: 73 verdes en la primera corrida. Mutación: quitar el `check` de al menos un canal hace fallar las 2 pruebas que lo fijan (y una tercera en cascada); la migración se restauró y `cmp` confirma que es idéntica.
  - Seguimiento: `integration.infra_alert` todavía no tiene productor (ni `anchor-audit` ni otro trabajo lo emite), y falta la pantalla del panel en la web.
  - La lint de `db` falla en `db/tests/first-organization-setup.test.ts:128-129`, archivo que este cambio no toca (idéntico a HEAD).
- L9 (2026-11-04): enlace T6→T7: el comando `anchor-audit` alerta a la Raíz cuando una organización queda sin ancla.
  - Qué hay:
    - puerto `AnchorFailureAlerter` en auditoría, conectado en `main.anchor-audit.ts`; auditoría no importa integraciones;
    - cola `PgInfrastructureAlertQueue`, que inserta `integration.infra_alert` (código `job_failed`) en el outbox con la organización de la transacción;
    - la alerta va en una transacción aparte, después del rollback del ancla. Si no se puede encolar, el trabajo sigue con las demás organizaciones y stderr dice «SIN alerta».
  - Jueces ciegos A y B: ningún defecto bloqueante.
    - Ambos señalan que no hay agrupación: una alerta por organización y ejecución. Ambos la juzgan acotada; se documenta en el runbook en vez de cambiar el comportamiento.
    - Solo A, para revisión humana: fijar con una prueba que la alerta no escribe auditoría.
    - Solo B, para revisión humana: ninguna prueba ejecuta el adaptador de `main.anchor-audit.ts` (la prueba de integración copia la lambda); la rama `alerted: false` solo se prueba con dobles.
  - Evidencia: tipos y lint en verde; pruebas dirigidas por `test-runner`: 25 verdes en 3 archivos. Mutación: quitar la llamada a la alerta hace fallar 2 pruebas (unitaria e integración); el archivo se restauró y `cmp` confirma que es idéntico.
  - Seguimiento: la pantalla del panel en la web; ningún otro trabajo programado emite todavía `integration.infra_alert`.
- L10 (2026-11-04): T7, pantalla del panel de alertas.
  - `/alerts` (pantalla «Alertas de infraestructura»): la Raíz enciende o apaga correo y Telegram. Solo aparece en el menú y responde con el permiso `alerts.infra.manage`; sin él muestra «no encontrado», igual que `/roles`. El servidor decide siempre.
  - Regla en la interfaz: con los dos canales apagados no se puede guardar y el motivo se lee junto al botón. El texto es el mismo que el del error `INTEGRATIONS.ALERT_CHANNEL_REQUIRED` del servidor.
  - Conflicto de versión: se descarta el borrador, se recargan los valores vigentes y se avisa. Con versión 0 se avisa que rigen los valores por defecto (los dos canales).
  - Textos en el catálogo diferido nuevo `integrations` (es-MX y en-US), igual que los demás módulos; en `common` solo queda la entrada del menú.
  - Corrección del montaje de una prueba nueva que nunca había corrido: fallaba una sola vez y Query reintenta los 5xx, así que el error no llegaba a verse. Ahora falla hasta que aparece el aviso, como en la prueba de cuentas. No se debilitó ninguna aserción.
  - Simplificación: se quitó `sameChannels`, que no se usaba; el rechazo del servidor se deriva del error de la acción, como en los formularios vecinos. Se conserva `staleTime: 0`, igual que en las pantallas vecinas, para ver cambios de otra Raíz.
  - Evidencia: tipos y lint en verde (`@iam/web`, `@iam/i18n`). Pruebas dirigidas por `test-runner`: 36 de 36 en 3 archivos. La revisión de seguridad no aplica (no toca autenticación, pagos ni SQL).
  - No verificado: el e2e no se corrió porque `docs/frontend.md` §11 no lo exige para esta pantalla; no hubo revisión visual en el navegador.
  - Pendiente fuera de T7: ningún otro trabajo programado emite todavía `integration.infra_alert`.
- L11 (2026-11-04): T3, mapa de código hecho por un explorador de solo lectura. Hallazgos, con ruta:
  - La baja actual (`apps/api/src/modules/directory/application/manage-users.ts:158-173`) solo reasigna subordinados, cambia el estado, cierra sesiones, revoca invitaciones y audita `reassignedReports`. No toca grupos, comparticiones ni rotación, aunque `docs/business/governance.md` §2.1 lo describe así. `user_deactivated` ya está permitido en el CHECK de `rotation_tasks` (`db/migrations/0006_governance_audit.sql`) y en la lista blanca de `audit-actions.ts:32`, pero nada lo usa.
  - Cuentas: `accounts` y `shares` (`0005_vault.sql`); «gestor» = nivel `MANAGE`; el índice único `shares_one_live_per_grantee` solo mira `revoked_at`, así que una compartición vencida sin revocar también bloquea el alta. La vista `effective_access` no filtra el estado del usuario. Para calcular «único gestor activo» hay que unir con `users.status = 'active'`, excluir a quien sale y bloquear sobre `accounts ... for update` por id (una vista no admite `for update`).
  - Jerarquía: `users.managed_by` con CTE recursivas; falta el helper «cadena de superiores» en `UserDirectory`.
  - Permisos de un tercero: `roles.rolePermissionsOf(userId)` + `effectivePermissions(roleSets, rank)` (`access/domain/effective-permissions.ts`); exigir `share.manage` (techo 3), `credential.update` (techo 3) y `rotation.manage` (techo 2).
  - Rotación: la deduplicación vive solo en la aplicación (`pg-share-repository.ts:226-236`); hoy usa 7 días y la persona que actúa como asignataria; la baja necesita 72 h y asignatario con `rotation.manage` (respaldo: la Raíz).
  - Capas: el puerto va en `directory/application/ports`, los adaptadores en `vault/infrastructure` y `access/infrastructure` (exportados por su `index.ts`) y el cableado en `apps/api/src/app/container.ts`. El patrón de evento a copiar es `user.rank_changed` (dominio, cola, handler, plantilla y `Mailer` con sus 3 implementaciones).
  - La alerta `integration.infra_alert` va solo a la Raíz; «Administrador y Raíz» pide un evento propio.
  - Reparto: (1) docs: adenda al ADR 0009 y regla de negocio; (2) lista blanca de auditoría y, si hace falta, migración de deduplicación; (3) cadena de superiores en `UserDirectory`; (4) puerto y adaptador de bóveda (cuentas huérfanas, concesión, rotación); (5) adaptador de acceso (candidato calificado); (6) eventos y correos (asignación, sin responsable, informe); (7) integración en `deactivate` y `container.ts`, bloqueos, medición y pruebas.
  - Sin verificar: si `listByAccount` filtra credenciales archivadas; si ya existe contrato del informe de baja en `packages/contracts`.
- L12 (2026-11-04): T3, regla de elección de quien recibe la cuenta (`apps/api/src/modules/directory/domain/account-manager-selection.ts`), función pura sin acceso a datos.
  - Recibe la cadena de superiores (del más cercano al más lejano) con dos hechos por persona: si está en la rama de quien da la baja y si ya tiene los permisos de compartir, editar credenciales y gestionar la rotación.
  - Primero, el superior activo más cercano que califique dentro de la rama (sin aviso). Si no hay, el Administrador activo más cercano que califique aunque esté fuera de la rama (con aviso). Si tampoco, la cuenta queda sin responsable.
  - Decisión conservadora anotada: fuera de la rama solo sirve un Administrador. La Raíz no es respaldo si quien da la baja es un Administrador y la Raíz no está en su rama; en ese caso la cuenta queda sin responsable y se alerta a Administradores y Raíz, como dice la regla del dueño («hasta el Administrador más cercano»). Si quien da la baja es la Raíz, ella misma está en la rama y puede recibirla.
  - Evidencia: tipos, lint y capas en verde; 10 pruebas dirigidas en verde. Rotura intencional (quitar la exigencia de permisos): fallan 2 pruebas; el archivo se restauró y `cmp` confirma que es idéntico. Pruebas de la regla marcadas para revisión humana por ser ruta protegida.
  - Pendiente de T3: adaptadores de bóveda (cuentas huérfanas, concesión, rotación a 72 h) y de acceso (permisos del candidato); eventos y correos (asignación, sin responsable, informe de baja); integración en `ManageUsers.deactivate`, cableado, orden de bloqueos, medición y pruebas de autorización y aislamiento.
- L13 (2026-11-04): T3, adaptador de bóveda para las bajas (puerto `OffboardingAccountStore` en `directory`, adaptador `PgOffboardingAccountStore` en `vault/infrastructure`). Ruta protegida (acceso a la bóveda): la prueba la debe revisar una persona.
  - `lockAccountsOnlyManagedBy`: cuentas activas donde la persona que se va es la única con gestión efectiva. Una persona suspendida, invitada o dada de baja no cuenta como gestor (la vista `effective_access` no mira el estado, por eso se une con `users`). Bloquea con `for update` ordenado por id.
  - `grantManagement`: si quien recibe ya tiene una compartición viva (aunque vencida), la sube a gestión y le quita el vencimiento; si no, crea una con el motivo `offboarding`. Así no choca con el índice único `shares_one_live_per_grantee`.
  - Evidencia: tipos, lint y capas en verde; 10 pruebas de integración en verde contra PostgreSQL (huérfana, otro gestor activo, gestor suspendido, gestión por grupo, nivel menor/vencida/archivada, orden, aislamiento por organización, subir nivel, insertar, otra organización). Rotura intencional (quitar el filtro de estado activo del otro gestor): fallan 2 pruebas; el archivo se restauró y `cmp` confirma que es idéntico.
  - Limitación conocida: la prueba de orden depende de que las pruebas anteriores dejen más de una cuenta huérfana en la misma organización; si se corre aislada puede no comparar nada.
- L14 (2026-11-04): T3, comprobación de permisos de quien recibe la cuenta. Puerto `CandidatePermissionChecker` en `directory`; adaptador `OffboardingPermissionChecker` en `access/application` (usa `RoleRepository` y `effectivePermissions`). Ruta protegida (acceso): la prueba la debe revisar una persona.
  - Exige `share.manage`, `credential.update` y `rotation.manage` dentro del techo de rango de la persona; nunca se le otorga un permiso para que califique.
  - Evidencia: tipos, lint y capas en verde; 6 pruebas unitarias en verde (tres permisos repartidos en varios roles, falta de cada permiso, Operador cortado por el techo de rango, sin roles). Rotura intencional (quitar `rotation.manage` de los requeridos): fallan 2 pruebas; el archivo se restauró y `cmp` confirma que es idéntico.
  - Pendiente de T3: baja de comparticiones y membresías de grupo de quien se va, acciones de auditoría, eventos y correos, tareas de rotación a 72 h e integración en `deactivate`.
- L15 (2026-11-04): T3, caso de uso `ReassignOffboardedAccounts` (`directory/application/reassign-offboarded-accounts.ts`). Une la cadena de superiores, la regla de elección (L12), el comprobador de permisos (L14) y la concesión de la bóveda (L13). Ruta protegida (acceso a la bóveda): la prueba la debe revisar una persona.
  - Debe correr dentro de la transacción de la baja y después del bloqueo de jerarquía (orden de bloqueos: jerarquía, luego cuentas por id). Sin cuentas huérfanas no lee la cadena ni consulta permisos.
  - La rama de quien da la baja son los eslabones de la cadena hasta él (incluido). Si no aparece en la cadena, nadie cuenta como de su rama (opción más restrictiva). A quien no está activo no se le consultan permisos.
  - Devuelve un informe (`reassigned` con motivo, aviso y si la compartición se creó o se subió de nivel; `unassignedAccountIds`). No audita, no avisa ni crea tareas de rotación: eso lo encadena quien lo llama (siguientes rebanadas).
  - Evidencia: tipos, lint y capas en verde; 7 pruebas unitarias en verde. Rotura intencional (marcar a todos como de la rama): fallan 2 pruebas; el archivo se restauró y `cmp` confirma que es idéntico.
  - Pendiente de T3: baja de comparticiones y membresías de grupo de quien se va, acciones de auditoría, eventos y correos, tareas de rotación a 72 h, cableado en `container.ts` e integración en `deactivate` con jueces A/B.
- L16 (2026-11-04): T3, adaptadores de limpieza de accesos y de rotación para las bajas. Puertos `OffboardingAccessCleanup` y `OffboardingRotationStore` en `directory`; adaptadores `PgOffboardingAccessCleanup` y `PgOffboardingRotationStore` en `vault/infrastructure`. Ruta protegida (acceso a la bóveda y rotación): la prueba la debe revisar una persona.
  - Limpieza: lista las cuentas no archivadas donde la persona tiene VER o más (directo o por grupo; USAR no cuenta porque no ve el secreto); debe leerse ANTES de retirar comparticiones y grupos. Revoca solo sus comparticiones directas (con `revoked_at` y `revoked_by`, nunca borra) y no toca las que ella otorgó. La saca de todos los grupos.
  - Rotación: lista las credenciales vivas de esas cuentas, cuáles reveló alguna vez la persona (auditoría, sin ventana de 180 días: la sección 2.4 rota todas) y crea una tarea `user_deactivated` por credencial sin duplicar una abierta. La deduplicación es por consulta; es segura porque la baja corre bajo el bloqueo de jerarquía.
  - Evidencia: tipos, lint y capas en verde; 8 pruebas de integración en verde. Rotura intencional (quitar la deduplicación y el filtro de archivadas): fallan exactamente 2 pruebas; los archivos se restauraron y `cmp` confirma que son idénticos.
  - Decisión conservadora anotada: «reveló alguna vez» no tiene ventana de tiempo, así que la prioridad alta puede cubrir más credenciales que con 180 días; es el lado seguro.
  - Pendiente de T3: orquestador que los encadena (con asignatario de rotación y plazo de 72 h), auditoría, eventos y correos, cableado en `container.ts` e integración en `deactivate` con jueces A/B.
- L17 (2026-11-04): T3, orquestador `OffboardAccounts` (directory/application). Ruta protegida (acceso y rotación): la prueba la debe revisar una persona.
  - Orden fijo: (1) leer cuentas con VER o más, (2) reasignar huérfanas, (3) revocar comparticiones directas y sacar de grupos, (4) tareas de rotación. El 1 va antes del 3 porque después no queda rastro; el 2 va antes del 3 porque la huérfana se calcula con la compartición vigente.
  - `ReassignOffboardedAccounts` gana `selectReceiver` (público) y acepta un `receiver` ya calculado para no leer la cadena dos veces; sin él se comporta igual que antes (7 pruebas previas intactas).
  - Rotación: todas las credenciales vivas de las cuentas expuestas, plazo `OFFBOARDING_ROTATION_DEADLINE_HOURS = 72`, prioridad alta si la persona las reveló. Receptor: quien recibe las cuentas (ya tiene `rotation.manage`); si nadie califica, la Raíz activa; sin Raíz activa lanza error y la baja se deshace (decisión conservadora: no dejar credenciales sin quien rote).
  - Decisión conservadora: el responsable de rotación es el mismo receptor aunque la cuenta no estuviera huérfana.
  - Evidencia: tipos y lint limpios; 13/13 en verde (6 nuevas). Rotura intencional (plazo 24 h y prioridad siempre normal): falló exactamente 1 prueba; archivo restaurado, `cmp` idéntico.
  - Pendiente de T3: auditoría, eventos y correos, cableado en `container.ts` e integración en `deactivate` con jueces A/B.
- L18 (2026-11-04): T3, auditoría de las bajas. Ruta protegida (auditoría): la prueba la debe revisar una persona.
  - Lista blanca de `audit-actions.ts`: `user.deactivated` admite además `exposedAccounts`, `reassignedAccounts`, `unassignedAccounts`, `revokedShares` y `removedGroups` (solo conteos). Acciones nuevas por cuenta: `account.offboarding_reassigned` (`leaverId`, `receiverId`, `reason`, `notified`, `grant`) y `account.offboarding_unassigned` (`leaverId`). Solo ids opacos y conteos; nunca nombres de cuentas ni de credenciales.
  - No hace falta migración: la tabla de auditoría no restringe `action` y la lista blanca es de aplicación.
  - Evidencia: tipos y lint limpios; 12/12 en verde (`audit-actions.offboarding.test.ts` nuevo + `audit-actions.integrations.test.ts`). La rotura intencional de este tramo se hará junto con la de la integración en `deactivate`, donde estas acciones se ejercen de punta a punta.
  - Pendiente de T3: eventos y correos, cableado en `container.ts` e integración en `deactivate` (que escribe estas auditorías), jueces A/B.
- L19 (2026-11-04): T3, eventos y correos de las bajas.
  - Un solo evento `user.offboarded` (solo ids, conteos y hora) y un solo método `Mailer.sendOffboardingNotice` con `kind`: `accounts_assigned` (a quien recibe cuentas FUERA de la rama), `accounts_unassigned` (a Administradores activos y Raíz si alguna cuenta quedó sin responsable) y `report` (a quien dio la baja, solo conteos). Implementado en los tres mailers (SMTP, registro, memoria) con textos es-MX y en-US.
  - `NotifyOffboarding`: idempotente por (evento, papel, destinataria) con clave `directory.offboarding-notice:<papel>:<id>` (74 caracteres, dentro de los 100 de `handler_key`); no avisa a personas suspendidas o dadas de baja; un fallo de envío lanza un error genérico sin datos y reintenta; contenido inválido va a cuarentena sin reintentos. Registrado en `container.ts`.
  - Nuevo `UserDirectory.listAdministratorRecipients` (con id, para el acuse por destinataria; `listAdministratorContacts` no cambia).
  - Decisión conservadora: el informe a quien dio la baja se envía siempre (solo conteos), aunque no haya cuentas afectadas.
  - Evidencia: tipos, lint y capas (543 módulos) limpios; 41/41 en verde (manejador, renderizador, SMTP, y el manejador de rango vecino sin cambios).
  - NO verificado todavía: `PgOffboardingNoticeQueue` y `PgUserDirectory.listAdministratorRecipients` contra PostgreSQL real; se cubren con las pruebas de integración de `deactivate` (siguiente paso). Nada encola aún el evento: lo hará `ManageUsers.deactivate`.
  - Pendiente de T3: integración en `ManageUsers.deactivate` (+ cableado de `OffboardAccounts` y de la cola), pruebas de integración, jueces A/B, rotura intencional, gobernanza §2.1 y §2.4.
