# Fase 1b · Publicador del outbox (H1a)

Objetivo: implementar el [ADR 0035](../../docs/adr/0035-transactional-outbox-for-events.md): trabajador por sondeo con `FOR UPDATE SKIP LOCKED`, entrega al menos una vez, reintentos con espera exponencial y cuarentena, dentro de la API. Sin manejadores reales (correo, avisos): es solo el registro y el bucle.

## Specs (textuales del encargo)

- Reclamar por lotes con `FOR UPDATE SKIP LOCKED`; marcar publicado; ante fallo, sumar intento y reprogramar con espera exponencial con tope; tras el máximo, dejar en cuarentena con el esquema existente.
- Registro de manejadores por `type`; un tipo desconocido no tumba el bucle; el `payload` nunca se registra.
- Cada evento se procesa con el contexto de su organización.
- Arranca con la API y se detiene al apagar; `OUTBOX_WORKER_ENABLED` apagado salvo orden expresa; `OUTBOX_POLL_INTERVAL_MS` acotada.

## Tareas

| ID    | Tarea                                                                                                        | Estado                               |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| H1a-1 | Módulo `outbox` (dominio, aplicación, infraestructura) y cableado en el contenedor                           | Hecha                                |
| H1a-2 | Configuración validada y arranque/apagado en `main.http.ts`                                                  | Hecha                                |
| H1a-3 | Pruebas unitarias e de integración (SKIP LOCKED, aislamiento, rollback)                                      | Escritas, sin ejecutar               |
| H1a-4 | Documentación (ADR 0035, `docs/backend.md` §6.5, `docs/deployment.md`)                                       | Hecha                                |
| H1b   | Manejadores reales: aviso de 24 h del segundo factor (N1a)                                                   | Hecha, pruebas escritas sin ejecutar |
| R2a   | Manejador del aviso de revelaciones a la Raíz (ADR 0031) con acuses de entrega idempotentes (migración 0019) | Hecha, pruebas escritas sin ejecutar |
| H1b-2 | Purga de versiones de secreto TOTP reemplazadas a los 30 días, dentro de `purge-expired` (ADR 0038)           | Hecha, pruebas escritas sin ejecutar |
| G1    | Retención de publicados: propuesta de 7 días NO definitiva, decide el dueño                                  | Pendiente                            |

## Bitácora

- 2026-10-28: implementado sin migración. Cuarentena = `next_attempt_at = 'infinity'` con `published_at` nulo. Código de fallo solo en el log (no hay columna). Verificado: `tsc`, `eslint` y `depcruise` en verde. NO ejecutadas las pruebas (las corre el agente de pruebas).
- 2026-10-28 (R2a): aviso por correo a la Raíz al superar el tope de revelaciones. Ruta protegida, con autorización de la persona.
  - Productor: ya existía `enqueueRevealLimitNotice` (misma transacción que la negación y su auditoría). Se amplió el contenido con conteo, ventana y hora; sigue sin secretos ni nombres de credenciales.
  - Consumidor: `NotifyRevealLimitExceeded` (módulo `vault`, registrado en el contenedor). Lee la Raíz activa (`UserDirectory.listRootContacts`) y el nombre de la persona del directorio, y envía con `Mailer.sendRevealLimitAlert` (puerto existente; sin transporte nuevo). Textos es-MX y en-US siguiendo `render-security-notice-email`.
  - Idempotencia por destinataria: la clave es (id del evento, id de la Raíz); `handler_key` = `vault.reveal-limit-notice:<id de la Raíz>` (62 caracteres, dentro del límite de 100). Acuse en `outbox_deliveries` (migración 0019, sin clave foránea a propósito), consultado antes de cada envío y anotado tras cada envío exitoso en una transacción independiente. Si falla una Raíz, el reintento solo reenvía a la pendiente. `listRootContacts` ahora devuelve también el id.
  - Saneo del nombre visible en el correo: se eliminan caracteres de control y de formato/bidi, se colapsan espacios y se acota a 80 caracteres (el escape HTML se mantiene).
  - Sin cambios de lint ni de capas; `depcruise`, `tsc`, `eslint` y `prettier` en verde. NO ejecutadas las pruebas (las corre el agente de pruebas): `src/modules/vault/domain/reveal-limit-notice.test.ts`, `src/modules/vault/application/notify-reveal-limit-exceeded.test.ts`, `src/modules/notification/application/render-reveal-limit-email.test.ts`, `src/modules/notification/infrastructure/smtp-mailer.test.ts`, `test/reveal-limit-notice.integration.test.ts`, `test/vault-credentials.e2e.test.ts` y `db/tests/rls.test.ts`.

### Decisiones abiertas de R2a (se aplicó la opción conservadora; decide el dueño)

1. **Contenido del correo.** `docs/business/` no dice qué datos lleva. Se incluye el nombre visible de la persona, el tope, el conteo y la hora UTC. Se omiten nombre de cuenta o credencial, motivo y cualquier enlace. Alternativa: incluir también el correo de la persona o no nombrarla.
2. **Sin Raíz activa.** El negocio no define el respaldo. Se falla para reintentar y, tras 8 intentos, queda en cuarentena (revisión humana); no se avisa a los Administradores. Alternativa: avisar a los Administradores.
3. **Un aviso por ventana.** Se conserva la regla de B2a: un evento por persona y ventana de una hora, no uno por intento negado.
4. **Duplicado frente a pérdida.** Si el proceso cae entre el envío y la anotación del acuse DE ESA destinataria, su correo puede repetirse. Se acepta: en una alerta de seguridad se prefiere un duplicado a perderla.
5. **Retención.** `outbox_deliveries` no tiene borrado para el rol de la aplicación hasta que se decida G1 (retención del outbox); crecerá un acuse por aviso entregado.
6. **Requiere `OUTBOX_WORKER_ENABLED=true`.** Apagado por defecto: sin él el aviso espera en `outbox_events` (el tipo ya tiene manejador, así que sale en cuanto se active).
7. **Payload inválido consume los 8 reintentos.** El trabajador no tiene una ruta "sin reintento": un error no reintentable (p. ej. un `payload` que no cumple el esquema) pasa por la misma espera exponencial y tarda horas en llegar a cuarentena aunque nunca pueda tener éxito. Decisión abierta de mejora del trabajador: distinguir un error no reintentable y mandar el evento a cuarentena de inmediato.
8. **Plazo del manejador frente a los tiempos del SMTP.** El plazo del manejador es de 30 s y los tiempos de espera del transporte SMTP suman 10 + 10 + 20 s. Si el plazo vence con el envío en curso, el trabajador revierte y reintenta mientras el correo aún puede salir, lo que deja una ventana de duplicado. Se acepta con instancia única (un duplicado antes que una alerta perdida); revisar si se sube el plazo o se bajan los tiempos del SMTP.

- 2026-10-28 (N1a): aviso por correo a quien registró un segundo factor y lo dejó sin confirmar más de 24 h. Ruta protegida, con autorización de la persona. Sin migración: `credential_totp.pending_notice_at` y el índice parcial ya existían (0018).
  - Barrido `EnqueuePendingTotpNotices` (módulo `vault`), ejecutado desde el sondeo del outbox como máximo cada 5 minutos. Por organización (`PgOrganizationLister` y `TenantScope.runAs`), reclama con `FOR UPDATE SKIP LOCKED` los registros `pending` con 24 h o más y sin `pending_notice_at`, marca la columna y escribe el evento en la misma transacción. Un fallo en una organización no detiene a las demás ni al trabajador.
  - Manejador `NotifyPendingTotpUnconfirmed` (tipo `credential.totp_pending_unconfirmed`): comprueba que el registro siga pendiente con la misma fecha de registro, resuelve a quien registró, envía con `Mailer.sendPendingTotpNotice` y anota el acuse (`vault.pending-totp-notice:<id>`).
  - Payload solo con ids y la fecha de registro. Textos es-MX y en-US con el nombre saneado (el saneador de R2a se extrajo a `sanitize-display-name.ts`).
  - Sin variable nueva: se activa con `OUTBOX_WORKER_ENABLED`.
  - Verificado solo en estático: `tsc`, `eslint`, `prettier` y `depcruise`. NO ejecutadas las pruebas: `src/modules/vault/domain/pending-totp-notice.test.ts`, `src/modules/vault/application/notify-pending-totp-unconfirmed.test.ts`, `src/modules/vault/application/enqueue-pending-totp-notices.test.ts`, `src/modules/notification/application/render-pending-totp-email.test.ts`, `src/modules/notification/infrastructure/smtp-mailer.test.ts`, `test/pending-totp-notice.integration.test.ts`; regresión: `render-reveal-limit-email.test.ts`, `test/reveal-limit-notice.integration.test.ts`, `test/outbox.integration.test.ts`, `test/vault-totp.e2e.test.ts`.
  - Ajuste tras la revisión adversarial (dos jueces ciegos): el barrido excluía las credenciales archivadas, pero el manejador solo revalidaba el segundo factor, así que una credencial archivada entre el barrido y la entrega aún disparaba el correo. Ahora el manejador lee la credencial con el puerto existente `CredentialRepository.findById` (`PgVaultCredentialRepository`, bajo RLS; sin puerto nuevo ni migración) y, si está archivada o ya no existe, omite el envío sin error ni acuse (el evento se cierra, igual que cuando el registro ya no está pendiente). Pruebas añadidas y NO ejecutadas: caso de credencial archivada o inexistente en `notify-pending-totp-unconfirmed.test.ts` y caso de archivado tras el barrido en `test/pending-totp-notice.integration.test.ts`.

### Decisiones abiertas de N1a (se aplicó la opción conservadora; decide el dueño)

1. **Destinataria.** S10 / DF-6 no dice a quién avisar ni si la dueña de la credencial debe enterarse. Se avisa solo a quien registró.
2. **Quien registró está suspendida o ya no existe.** No se envía nada ni se reintenta. Alternativa: avisar a la dueña o a la Raíz.
3. **Contenido.** El correo omite nombre de cuenta y credencial y no lleva enlaces, así que la persona no sabe cuál es. Alternativa: incluir el nombre de la credencial.
4. **Auditoría.** El barrido no audita (es mantenimiento del sistema sin actor, como la purga). Alternativa: auditar con actor nulo, si el motor de autorización lo exige para acciones del sistema.
5. **Cadencia.** Barrido cada 5 minutos como mínimo y lotes de 100 por organización.
6. **Requiere `OUTBOX_WORKER_ENABLED=true`.** Sin él, nada se barre ni se envía.
7. **Duplicado entre envío y acuse.** Si el proceso cae entre ambos, el correo puede repetirse (mismo criterio que R2a).
8. **Retención de acuses.** Crece un acuse por aviso hasta decidir G1.
9. **Después del aviso no pasa nada.** No se cancela el secreto pendiente (pregunta abierta 2 de `docs/business/two-factor.md`).

- 2026-10-29 (H1b-2): purga de versiones del secreto TOTP reemplazadas hace más de 30 días. Ruta protegida, con autorización de la persona. Sin migración ni dependencias.
  - Hallazgo verificado: `credential_totp.replace()` sobrescribe la fila (solo el registro vigente), pero el secreto cifrado vive en `credential_secrets` (`field = 'totp_uri'`), donde cada re-registro inserta una versión nueva y marca la anterior `is_current = false`. Las versiones reemplazadas sí existen. El rol de la aplicación ya tenía `DELETE` y la política `credential_secrets_purge_old` (0005) impide borrar la vigente, así que no hace falta migración 0020 ni cambiar `db/tests/rls.test.ts`.
  - Implementación: puerto `ReplacedTotpSecretStore` y `PgReplacedTotpSecretStore` (módulo `maintenance`), integrados en `PurgeExpiredEphemeral` (mismo comando `purge-expired`, por organización con `TenantScope.runAs`, lotes de 1000, idempotente). Constante `REPLACED_TOTP_SECRET_RETENTION_DAYS = 30`. El momento del reemplazo es la fecha de creación de la versión posterior. El conteo se agrega a la línea de resumen; no se registran ids ni contenido.
  - NO ejecutadas las pruebas (las corre el agente de pruebas): `src/modules/maintenance/application/purge-expired-ephemeral.test.ts` y `test/purge-expired.integration.test.ts`; regresión: `test/vault-totp.e2e.test.ts`. Verificado solo en estático: `prettier`, `tsc`, `eslint` y `depcruise`.

### Decisiones abiertas de H1b-2 (se aplicó la opción conservadora; decide el dueño)

1. **Auditoría.** No se audita (como el resto de `purge-expired`). Alternativa: evento con actor nulo y solo el conteo por organización.
2. **30 días fijo.** `vault.md` dice "configurable" pero no define cómo. Alternativa: variable de entorno validada al arrancar.
3. **Sin retención general (C9).** Contraseñas y demás campos no se purgan; sigue bloqueada por decisión del dueño.
4. **Sin índice parcial** sobre versiones no vigentes; el borrado recorre las filas de la organización.
5. **Cron.** Sigue sin programarse `purge-expired` en el despliegue; sin eso, nada se purga.
6. **Secreto retirado sin sucesora.** Una versión que se retira (`retireCurrentSecret`) sin re-registro no tiene versión posterior, así que nunca se purga, aunque BO-6 y DF-10 hablan de 30 días. Es sobre-retención, no pérdida. Opción conservadora aplicada: no borrar. Alternativa: contar los 30 días desde la fecha de retiro, lo que exige guardar esa fecha (migración nueva).
7. **Sucesora sin confirmar.** La regla "30 días desde la sucesora" no exige que la sucesora esté confirmada: si un re-registro queda pendiente y nunca se confirma, la versión anterior se destruye igual a los 30 días (DF-10 lo dice literalmente). Alternativa: exigir sucesora confirmada. Señalado por un solo juez; el dueño decide.
8. **Prueba corregida.** En `test/purge-expired.integration.test.ts` la prueba de aislamiento esperaba 1 borrado y son 2 (con el corte en 2100 también cae la v2 de `chain`, que tiene sucesora v3). Se corrigió la expectativa del test, no el código. Revisión humana pendiente de esa prueba (aislamiento).
