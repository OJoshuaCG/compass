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
| H1b   | Manejadores reales: aviso de 24 h del segundo factor                                                         | Pendiente                            |
| R2a   | Manejador del aviso de revelaciones a la Raíz (ADR 0031) con acuses de entrega idempotentes (migración 0019) | Hecha, pruebas escritas sin ejecutar |
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
