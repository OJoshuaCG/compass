# Endurecimiento del outbox: correo duplicado, errores no reintentables y retención

Las tres decisiones las tomó el panel de dos jueces (`jd-judge-a` y `jd-judge-b`) por unanimidad. Trabajo sobre el publicador del outbox ([ADR 0035](../../docs/adr/0035-transactional-outbox-for-events.md)).

## Especificaciones (lo pedido)

- **T-D4**: cerrar la ventana de correo duplicado. Los tiempos del SMTP (conexión, saludo, socket) podían sumar más que el plazo del manejador (30 s) y la parada (35 s). Hacer AMBAS cosas: bajar los tiempos SMTP para que el peor caso por intento quede claramente por debajo del plazo, y subir el plazo del manejador y el de parada con margen, manteniendo parada > plazo. Constantes con nombre, comentario del porqué y una prueba de la invariante.
- **T-T9**: un error NO reintentable del manejador va a cuarentena (dead letter) de inmediato, sin consumir los 8 reintentos, reutilizando el mecanismo existente (`published_at` nulo y `next_attempt_at = 'infinity'`).
- **T-D6**: retención del outbox: borrar eventos publicados con más de 7 días con sus entregas, sin tocar los no publicados ni los de cuarentena; imitar `purge-expired`. Si exige rol, política o migración con aislamiento (ruta protegida), NO hacerla: documentarla como omitida con el motivo.

## Tareas

- [x] T-D4: SMTP 5 s + 5 s + 10 s = 20 s (antes 10 + 10 + 20 = 40 s); plazo del manejador 30 s a 45 s; parada 35 s a 60 s. Constantes `SMTP_*_TIMEOUT_MS`, `SMTP_WORST_CASE_ATTEMPT_MS`. Prueba `apps/api/src/app/outbox-timeouts.test.ts`.
- [x] T-T9: `isNonRetryableError` (`retry-policy.ts`); el trabajador manda a cuarentena un error con `retryable = false`. Los tres errores de payload inválido (`RankChangeNoticePayloadError`, `RevealLimitNoticePayloadError`, `PendingTotpNoticePayloadError`) lo declaran. Pruebas unitarias del trabajador y caso de integración en `outbox.integration.test.ts`.
- [ ] T-D6: **OMITIDA** (ver abajo).
- [x] Documentación: `docs/backend.md` §6.5, ADR 0035, `docs/runbooks/purge-expired.md`.

## Decisiones de diseño

- El marcador es una propiedad (`retryable = false`) y no una clase del outbox: los módulos de negocio no importan el outbox (solo lo cablea el contenedor), así que una clase compartida habría creado una dependencia entre módulos.
- Un destinatario inexistente o dado de baja ya no lanza: el manejador omite el envío sin fallar, así que no pasa por cuarentena. `VAULT.REVEAL_NOTICE_NO_ROOT` sigue siendo reintentable a propósito (una Raíz puede aparecer).
- Un plazo de 45 s deja el peor caso SMTP en menos de la mitad; la parada de 60 s da 15 s para anotar el fallo tras vencer el plazo.

## T-D6 omitida: motivo

`iam_app` solo tiene `grant select, insert` sobre `outbox_deliveries` (migración 0019, comentario: «el borrado se deja fuera hasta decidir la retención»). Borrar acuses exige una migración nueva con `grant delete` sobre una tabla con aislamiento por filas: ruta protegida (migraciones con aislamiento) que no se modifica sin encargo humano explícito. Borrar solo los eventos dejaría acuses huérfanos (no hay clave foránea), contra lo pedido. Propuesta para cuando se encargue: migración con `grant delete on outbox_deliveries to iam_app` (la política `for all` ya cubre el borrado), caso de uso y repositorio en `modules/maintenance` calcados de `PurgeExpiredEphemeral`, constante `OUTBOX_PUBLISHED_RETENTION_DAYS = 7`, borrar primero los acuses de los eventos publicados vencidos y luego los eventos (`published_at is not null and published_at < corte`), en lotes por organización, y entrada `main.purge-outbox.ts` agendada como `purge-expired` (cron diario; no se programó cron: requiere despliegue).

## Bitácora

- 2026-10-29: implementadas T-D4 y T-T9; T-D6 omitida por requerir migración con aislamiento. Las pruebas las corre otro agente; aquí solo se comprobaron formato, tipos y lint.
