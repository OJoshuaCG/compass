# D5 · Permiso propio para restaurar una versión de la contraseña

Estado: **código y pruebas escritos, pruebas SIN ejecutar** (2026-10-30). Falta ejecutarlas y la revisión humana de las rutas protegidas.

Origen: lo encargó explícitamente el dueño y lo recomendó por unanimidad el panel de dos jueces (ciegos A y B). Cierra la decisión abierta de M2 en `odd/tasks/phase-1b-vault.md` ("¿permiso propio para restaurar?"). Es ruta protegida (acceso, migración con permisos de roles): la revisión humana es obligatoria.

## Especificación

Pedido (textual del encargo): crear el permiso propio `credential.restore_version` para restaurar una versión anterior de una credencial; hoy se usa `credential.update`.

1. El permiso existe en el catálogo del contrato (`PERMISSIONS`), en el motor de autorización (`PERMISSION_CEILING`, techo 3, igual que `credential.update`) y tiene etiquetas en es-MX y en-US con las mismas claves.
2. Restaurar exige `credential.restore_version` Y nivel EDIT sobre la cuenta. `credential.update` ya no basta, y `credential.restore_version` solo no basta para cambiar la contraseña.
3. La decide el motor del módulo de acceso (`authorizer.require` en el caso de uso), no la guarda del controlador. Toda negación se audita (`authz.denied`) con `credential.restore_version` como permiso: sin permiso (`AUTHZ.PERMISSION`), por nivel (`AUTHZ.SHARE`) y sin acceso (`NOT_FOUND`).
4. No se rompe lo que ya funciona: los roles de sistema que tenían `credential.update` reciben el permiso nuevo (plantillas y migración). Los roles personalizados NO lo reciben solos.
5. La base lo reconoce: el trigger de techo de rango (0015) rechaza permisos que `permission_rank_ceiling()` no conoce, así que el permiso nuevo se agrega ahí.
6. Web: el botón "Restaurar" del historial sigue el permiso nuevo.

Fuera de alcance: el rojo previo de `authorization-matrix.e2e.test.ts` por las rutas `credentials/import` (no es de esta tarea, no se tocó); obligaciones adicionales (reautenticación o motivo) para restaurar; purga y retención de versiones.

## Decisiones de diseño

- **Techo 3 y sin obligaciones.** Mismo techo que `credential.update` para que el Operador conserve lo que hoy puede hacer; `ACTION_POLICY` sin entrada (restaurar no revela nada y no exige reautenticación ni motivo, como cambiar la contraseña). Si el negocio quiere más control, es una decisión aparte.
- **La migración sí concede a roles existentes.** Patrón de la 0005 (levantar y restablecer `force row level security` en la misma transacción, porque el migrador no puede saltarse el aislamiento por organización). Solo roles de sistema vivos con `credential.update`; sube `version` en 1; idempotente. Compensa un rol de sistema que, sin esto, perdería la restauración hasta correr `sync-system-roles`.
- **Sin evento de auditoría en la migración** (decisión para revisión humana): la cadena de auditoría por organización solo la agrega la aplicación; el rastro es la propia migración (con huella) y el incremento de `roles.version`. El comando `sync-system-roles` no dejará eventos para este cambio porque ya no encontrará diferencias. Alternativa descartada: no conceder en la migración y dejar que el comando audite (obliga a un paso manual y deja una ventana en que restaurar se niega a todos).
- **Roles personalizados quedan sin el permiso** (mínimo privilegio): una persona debe agregarlo desde la pantalla de roles. Consecuencia visible: un rol personalizado con `credential.update` deja de poder restaurar hasta que se le agregue.
- **`SYSTEM_ROLES_VERSION` sube de 2 a 3**: las plantillas ganan un permiso derivado del techo (no hay lista manual que editar).
- **`permission-ceiling-sync.test.ts` ahora lee la 0021**, porque es la última definición de `permission_rank_ceiling()` (la 0015 ya no la tiene completa). Hay que apuntarlo a la migración que la redefina la próxima vez.
- **Etiqueta de auditoría de la negación por nivel**: ahora usa `credential.restore_version` en vez de `credential.update`, para que la auditoría diga qué permiso se intentó usar.

## Tareas

- [x] Contrato: `PERMISSIONS` (`packages/contracts/src/permissions.ts`).
- [x] Motor: `PERMISSION_CEILING` (`permission-catalog.ts`); plantillas derivadas; `SYSTEM_ROLES_VERSION = 3`.
- [x] i18n: `permission.credential.restore_version` en es-MX y en-US (`roles.json`).
- [x] Migración nueva `db/migrations/0021_credential_restore_version_permission.sql` (función de techo y concesión a roles de sistema). Ninguna migración aplicada se editó.
- [x] Caso de uso `ManageCredentials.restoreVersion` exige el permiso nuevo y audita la negación por nivel con él. El controlador no cambia (no decide permisos).
- [x] Web: `canRestoreVersion` (`credential-access.ts`) y `HistoryDialog` ocultan "Restaurar" sin el permiso.
- [x] Pruebas (ver abajo).
- [x] Documentación: `docs/business/vault.md`, `docs/business/permissions-and-sharing.md`, `docs/backend.md`, `docs/database.md`, cuentas de "27 permisos" → 28, `TODO.md`, `docs/handoff.md`, `odd/tasks/phase-1b-vault.md`.
- [ ] Ejecutar las pruebas (otro agente), revisión humana y mutación a propósito (quitar el permiso del caso de uso y comprobar que falla alguna prueba SENSIBLE).
- [ ] Desplegar: correr `migrate` (la 0021 concede a roles de sistema). Después, `sync-system-roles` es opcional (no debe encontrar diferencias) y sirve de comprobación.

## Pruebas nuevas o ajustadas (sin ejecutar)

- `apps/api/src/modules/vault/application/manage-credentials.restore-version.test.ts` (nueva, unitaria, motor REAL con directorio y roles en memoria, SENSIBLE): restaura con el permiso nuevo y EDIT; con `credential.update` pero sin el nuevo se deniega (`AUTHZ.PERMISSION`), se audita con `credential.restore_version` y no se descifra ni se escribe nada; sin permisos; con el permiso pero VIEW (`AUTHZ.SHARE`, auditado); con el permiso y sin acceso (`NOT_FOUND`, auditado).
- `apps/api/test/vault-credentials.e2e.test.ts` (ajustada): dos roles personalizados y dos personas nuevas en `beforeAll` (`updateonly@creds.test` con solo `credential.update`; `restoreonly@creds.test` con solo `credential.restore_version`) y dos pruebas SENSIBLE: la primera niega a quien solo tiene `credential.update` (403 `AUTHZ.PERMISSION`, `authz.denied` con el permiso nuevo, sin versión nueva) y comprueba que cambiar la contraseña sigue funcionando; la segunda restaura solo con el permiso nuevo y comprueba que cambiar la contraseña se niega.
- `apps/api/src/modules/access/domain/access-domain.test.ts` (ajustada): 28 permisos y el techo del nuevo.
- `apps/api/src/modules/access/domain/permission-ceiling-sync.test.ts` (ajustada): compara contra la 0021; cubre que SQL y código coinciden y que el catálogo completo está en SQL.
- `db/tests/role-rank-ceiling.test.ts` (ajustada): la base conoce el permiso con techo 3 y se puede asignar a un Operador.
- `db/tests/credential-restore-version-migration.test.ts` (nueva, SENSIBLE): aplica las migraciones hasta la 0020, siembra roles (de sistema con y sin `credential.update`, personalizado, archivado, en dos organizaciones), aplica la 0021 y comprueba quién recibe el permiso, la versión, la idempotencia y que el aislamiento forzado queda restablecido.
- `apps/web/src/features/credentials/credentials.test.tsx` (ajustada): `ALL_PERMISSIONS` incluye el permiso nuevo; dos pruebas SENSIBLE (sin el permiso no hay botón aunque haya `credential.update`; solo con el permiso nuevo sí lo hay).
- `apps/web/src/features/credentials/model/credential-model.test.ts` (ajustada): `canRestoreVersion` exige EDIT y su permiso.
- `apps/api/test/authorization-matrix.e2e.test.ts` (protegida): **no se editó**. La ruta de restaurar ya estaba en la matriz y la matriz no enumera permisos.

Otras pruebas que enumeran `PERMISSIONS` se adaptan solas (`identity.e2e.test.ts`, `roles.test.tsx`, `permission-groups.test.ts`).

## Bitácora

- 2026-10-30, D5 (código, migración, pruebas y documentación escritos; pruebas NO ejecutadas). Verificación estática al cierre: ver el reporte de la tarea. Pendiente: ejecución por otro agente, revisión humana (autorización, migración y auditoría), mutación a propósito.
