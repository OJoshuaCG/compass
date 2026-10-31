# Endurecimiento del outbox: correo duplicado, errores no reintentables y retención

Las tres decisiones las tomó el panel de dos jueces (`jd-judge-a` y `jd-judge-b`) por unanimidad. Trabajo sobre el publicador del outbox ([ADR 0035](../../docs/adr/0035-transactional-outbox-for-events.md)).

## Especificaciones (lo pedido)

- **T-D4**: cerrar la ventana de correo duplicado. Los tiempos del SMTP (conexión, saludo, socket) podían sumar más que el plazo del manejador (30 s) y la parada (35 s). Hacer AMBAS cosas: bajar los tiempos SMTP para que el peor caso por intento quede claramente por debajo del plazo, y subir el plazo del manejador y el de parada con margen, manteniendo parada > plazo. Constantes con nombre, comentario del porqué y una prueba de la invariante.
- **T-T9**: un error NO reintentable del manejador va a cuarentena (dead letter) de inmediato, sin consumir los 8 reintentos, reutilizando el mecanismo existente (`published_at` nulo y `next_attempt_at = 'infinity'`).
- **T-D6**: retención del outbox: borrar eventos publicados con más de 7 días con sus entregas, sin tocar los no publicados ni los de cuarentena; imitar `purge-expired`. Si exige rol, política o migración con aislamiento (ruta protegida), NO hacerla: documentarla como omitida con el motivo.

## Tareas

- [x] T-D4: SMTP 5 s + 5 s + 10 s = 20 s (antes 10 + 10 + 20 = 40 s); plazo del manejador 30 s a 45 s; parada 35 s a 60 s. Constantes `SMTP_*_TIMEOUT_MS`, `SMTP_WORST_CASE_ATTEMPT_MS`. Prueba `apps/api/src/app/outbox-timeouts.test.ts`.
- [x] T-T9: `isNonRetryableError` (`retry-policy.ts`); el trabajador manda a cuarentena un error con `retryable = false`. Los tres errores de payload inválido (`RankChangeNoticePayloadError`, `RevealLimitNoticePayloadError`, `PendingTotpNoticePayloadError`) lo declaran. Pruebas unitarias del trabajador y caso de integración en `outbox.integration.test.ts`.
- [x] T-D6: hecha (2026-10-30, encargo expreso del dueño; pruebas escritas sin ejecutar). Retención a 7 días en `purge-expired`: ver «T-D6: implementación».
- [x] Documentación: `docs/backend.md` §6.5, ADR 0035 (adenda D6), ADR 0038, `docs/database.md`, `docs/threat-model.md`, `docs/runbooks/purge-expired.md`, `TODO.md`.

## Decisiones de diseño

- El marcador es una propiedad (`retryable = false`) y no una clase del outbox: los módulos de negocio no importan el outbox (solo lo cablea el contenedor), así que una clase compartida habría creado una dependencia entre módulos.
- Un destinatario inexistente o dado de baja ya no lanza: el manejador omite el envío sin fallar, así que no pasa por cuarentena. `VAULT.REVEAL_NOTICE_NO_ROOT` sigue siendo reintentable a propósito (una Raíz puede aparecer).
- Un plazo de 45 s deja el peor caso SMTP en menos de la mitad; la parada de 60 s da 15 s para anotar el fallo tras vencer el plazo.

## T-D6: implementación

El dueño autorizó la ruta protegida y decidió la retención: borrar los eventos publicados hace más de 7 días y sus acuses.

- Migración `0022_outbox_deliveries_retention.sql`: solo `grant delete on outbox_deliveries to iam_app`. No hay política ni función nuevas: la política `for all` de la 0019 ya confina el borrado a la organización, y `outbox_events` ya tenía `delete` desde la 0003.
- `PgOutboxRetentionStore` (módulo `maintenance`): elige un lote de eventos con `published_at` no nulo y anterior al corte, borra primero sus acuses y luego los eventos, en la misma transacción. Nunca toca no publicados ni cuarentena. No lee `payload`.
- `PurgeExpiredEphemeral` suma el paso por organización (mismo recorrido, `TenantScope.runAs` sin actor, lotes de `PURGE_BATCH_SIZE` eventos) y el resumen trae `outboxEvents` y `outboxDeliveries`. Sin auditoría, igual que el resto de la purga.
- `OUTBOX_RETENTION_DAYS = 7` es una constante hasta que exista la tabla de ajustes del sistema; entonces vivirá en la base de datos. Esa tabla quedó **diferida** tras la revisión de dos jueces: ver `odd/tasks/system-settings.md`.
- Pruebas: unitarias en `purge-expired-ephemeral.test.ts`; de integración en `apps/api/test/purge-expired.integration.test.ts` (borrado de publicado viejo con acuses, conservación de reciente, no publicado y cuarentena, aislamiento entre organizaciones, idempotencia y permisos de `iam_app`). Las de aislamiento y permisos llevan `// SENSIBLE (revisión humana)`.
- No hay índice sobre `published_at`: con 7 días de retención la tabla es pequeña. Si crece, añadir uno parcial `(organization_id, published_at) where published_at is not null` en otra migración.
- Falta programar el cron del despliegue (el mismo de `purge-expired`) y aplicar la migración 0022 antes de desplegar el comando.

## T-D6 omitida: motivo (histórico, ya superado)

`iam_app` solo tiene `grant select, insert` sobre `outbox_deliveries` (migración 0019, comentario: «el borrado se deja fuera hasta decidir la retención»). Borrar acuses exige una migración nueva con `grant delete` sobre una tabla con aislamiento por filas: ruta protegida (migraciones con aislamiento) que no se modifica sin encargo humano explícito. Borrar solo los eventos dejaría acuses huérfanos (no hay clave foránea), contra lo pedido. Propuesta para cuando se encargue: migración con `grant delete on outbox_deliveries to iam_app` (la política `for all` ya cubre el borrado), caso de uso y repositorio en `modules/maintenance` calcados de `PurgeExpiredEphemeral`, constante `OUTBOX_PUBLISHED_RETENTION_DAYS = 7`, borrar primero los acuses de los eventos publicados vencidos y luego los eventos (`published_at is not null and published_at < corte`), en lotes por organización, y entrada `main.purge-outbox.ts` agendada como `purge-expired` (cron diario; no se programó cron: requiere despliegue).

## Bitácora

- 2026-10-29: implementadas T-D4 y T-T9; T-D6 omitida por requerir migración con aislamiento. Las pruebas las corre otro agente; aquí solo se comprobaron formato, tipos y lint.
- 2026-10-30: T-D6 hecha por encargo expreso del dueño (migración 0022, purga en `purge-expired`, pruebas, documentación). Pruebas escritas sin ejecutar (las corre otro agente); solo se comprobaron formato, tipos y lint.
