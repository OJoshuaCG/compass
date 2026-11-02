# Roles, responsable y estado en la pestaña Equipo

Objetivo: que la pestaña **Equipo** de Usuarios muestre, como el prototipo de Compass, el responsable, los roles y el estado de cada persona que gestiona quien consulta, respetando la regla AC-11 (`docs/business/actors-and-hierarchy.md` §9). Método: iteraciones hasta 5, revisión adversarial con dos revisores ciegos sobre el mismo alcance congelado, mutación manual.

## Specs

Textual de lo pedido el 2026-11-01: "en la vista de usuarios, no viene rol ni estado como en el prototipo". Opción elegida por la persona: "Equipo con roles (API): GET /users/managed devuelve los nombres de los roles de cada persona (solo a quien la gestiona, mismo motor de autorización), con pruebas de aislamiento/autorización, revisión adversarial y mutaciones. En la web, la pestaña Equipo muestra Responsable, Roles y Estado como el prototipo."

- S1. El directorio visible para todos no cambia: nombre, correo y rango (AC-11).
- S2. `GET /users/managed` devuelve, por persona, el nombre de su responsable (`managerName`).
- S3. `GET /users/managed` devuelve los nombres de los roles vigentes (`roleNames`) solo cuando quien consulta podría verlos uno por uno: tiene `user.invite` y gestiona a esa persona (misma regla que `ManagePersonRoles.view`). En otro caso, `null`.
- S4. El rol personal (permisos especiales) no se lista: es oculto por diseño. Los roles archivados tampoco.
- S5. La lectura de roles es una sola consulta por página, bajo RLS, sin auditar una negación por fila.
- S6. Sin migraciones ni dependencias nuevas.
- S7. La web muestra en Equipo: persona (avatar, nombre, correo), rango, responsable, roles y estado, en es-MX y en-US.

## Tasks

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| T1 Contrato `managedUserSchema` con `managerName` y `roleNames` | S2, S3 | inline | hecha |
| T2 `directory`: puerto `AssignedRoleNamesReader`, `ListManaged` con la regla de S3, nombre del responsable en el SQL | S2, S3, S5 | inline | hecha |
| T3 `access`: lectura por lote de los nombres de roles vigentes, sin rol personal ni archivados | S4, S5 | inline | hecha |
| T4 Pruebas: unitarias de `ListManaged`, HTTP con base real (alcance, permiso, aislamiento) | S1 a S5 | inline | hecha |
| T5 Web: columnas de Equipo y textos | S7 | inline | hecha |
| T6 Revisión adversarial, mutación y documentación | todas | inline | hecha |

## Bitácora

- 2026-11-01: Diseño. La regla de visibilidad de roles ya existe en `ManagePersonRoles.view` (`user.invite` sobre la persona = permiso + gestión por jerarquía); `ListManaged` la replica por fila con `canManage` y `actorPermissions()`, que no audita. El puerto sigue el patrón de `AssignedRoleRevoker` para no crear un ciclo `directory` → `access`.
- 2026-11-01: Implementación. API: `managerName` (una consulta por página sobre los responsables) y `roleNames` (puerto `AssignedRoleNamesReader` implementado por `PgRoleRepository.listLiveRoleNames`, una consulta por página, sin rol personal ni archivados). Web: columnas Persona, Rango, Responsable, Roles y Estado; "—" con texto para lectores de pantalla distingue "no visible" de "sin roles". Pruebas: unitarias de `ListManaged` (8) y HTTP con base real en `team.e2e` (alcance, permiso, rol personal, archivado, mismo rango). En esta máquina corrieron contra PostgreSQL nativo con una configuración local no versionada; la CI debe correr las suites con contenedores. La matriz de rutas (`authorization-matrix.e2e`) falla 2 casos por rutas de importación de credenciales; falla igual sin este cambio (viene de main).
- 2026-11-01: Mutación manual, todas detectadas y revertidas: sin exigir `user.invite` (1 unitaria), sin `canManage` por fila (1 unitaria y, tras la revisión, 1 HTTP), lista vacía en lugar de `null` (2 unitarias), sin filtro del rol personal (1 HTTP), sin filtro de archivados (1 HTTP).
- 2026-11-01: Revisión adversarial con dos revisores ciegos sobre el mismo parche congelado (los agentes `jd-judge-a` y `jd-judge-b` no existen en este entorno; se usaron dos revisores independientes con la misma instrucción). Ambos: sin fuga de información ni falla de aislamiento; la regla equivale a la de `ManagePersonRoles.view`. Confirmados por ambos y corregidos: (1) las iniciales del avatar partían por la letra "s" (`/s+/`): corregido y con prueba; (2) un `sort=email` heredado ordenaba sin indicador visible: se descarta en la pestaña Equipo, con prueba; (3) ninguna prueba HTTP cubría una fila listada con roles ocultos por rango: prueba nueva (mismo rango dentro del subárbol). De un solo revisor, corregido por su bajo riesgo: "Responsible" pasa a "Manager" en inglés. Anotado sin corregir: las pruebas HTTP de roles modifican datos del Líder 3 y los restauran en `finally`; no hay prueba HTTP entre organizaciones para estos campos (los cubre RLS).
- Pendiente: que una persona revise las pruebas marcadas SENSIBLE (`list-managed.test.ts` y `team.e2e.test.ts`), y que la CI corra las suites con contenedores.
