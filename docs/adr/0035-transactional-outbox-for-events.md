# ADR 0035: Eventos mediante bandeja de salida transaccional

- **Estado**: Aceptada (2026-10-27). Trabajador implementado dentro de la API (2026-10-28, tarea H1a); primer manejador real (aviso de revelaciones a la Raíz, R2a) con acuses de entrega; retención de publicados pendiente
- **Fecha**: 2026-10-27
- **Referencias**: `db/migrations/0003_*` (tabla `outbox_events`, hoy sin escritor ni publicador); [ADR 0023](0023-audit-advisory-lock-and-long-transactions.md); tarea H1.

## Contexto

La tabla `outbox_events` existe pero ningún código la escribe ni la consume. Hacen falta notificaciones y tareas diferidas (correos, avisos de rotación) sin perder eventos si el proceso cae.

## Decisión

1. **Bandeja transaccional**: el evento se inserta en la misma transacción que la acción.
2. **Trabajador por sondeo** con `FOR UPDATE SKIP LOCKED`; entrega **al menos una vez**; los consumidores son idempotentes por id de evento.
3. **Orden** por agregado u organización, apoyado en UUIDv7.
4. El trabajador arranca **dentro del proceso de la API** y se separa después en `main.worker.ts` (alinear con H1).
5. Se define la **retención de eventos publicados** (tarea G1).

## Alternativas

- **Broker de mensajes externo**: _(inferida)_ innecesario para una sola instancia y suma infraestructura.
- **Publicar tras el commit sin bandeja**: descartada; pierde eventos si el proceso cae entre ambos pasos.

## Consecuencias

- **Positivas**: sin pérdida de eventos; sin infraestructura nueva.
- **Negativas**: duplicados posibles (por eso la idempotencia); el sondeo añade latencia y carga.
- **Implementado (H1a)**: módulo `apps/api/src/modules/outbox/`. Un manejador por `type` (`OutboxHandlerRegistry.register`); cada evento se procesa en su propia transacción con el `app.org_id` de su organización (mismo recorrido que la purga, ADR 0038), de modo que un manejador no puede leer otros inquilinos. Si el manejador falla, su transacción se revierte y el intento se anota aparte: espera exponencial de 30 s con tope de 1 h y 8 intentos como máximo. Agotados los intentos, el evento queda sin publicar con `next_attempt_at = 'infinity'` (cuarentena; el esquema no tiene columna de estado y no se agregó migración). Un error marcado como no reintentable (`retryable = false`, p. ej. payload inválido) va a cuarentena en el primer fallo. Cada manejador tiene un plazo de 45 s por evento (el peor caso SMTP son 20 s): si vence, cuenta como fallo (`OUTBOX.HANDLER_TIMEOUT`) y se revierte la transacción (JavaScript no cancela el manejador, que debe ser idempotente). Un tipo **sin manejador NO cuenta intentos ni entra en cuarentena**: queda pendiente y se reprograma al tope de la espera (1 h), con un aviso por pasada y tipo (`OUTBOX.UNKNOWN_TYPE`, solo nombre del tipo y conteo). Así un evento escrito antes de que exista su manejador (p. ej. el aviso del límite de reveladas de la bóveda) no se pierde. El trabajador comprueba además que el evento reclamado pertenezca a la organización del ámbito; si no, no lo procesa y cuenta la organización como fallida. El apagado ordenado termina la pasada tras el evento en curso y espera como máximo 60 s. El contenido (`payload`) nunca se registra. Se activa con `OUTBOX_WORKER_ENABLED=true` (apagado por defecto).
- **Limitaciones conocidas**: el código de fallo solo se registra en el log (no hay columna donde guardarlo; una columna `last_error_code` exigiría una migración); cada pasada abre al menos una transacción por organización; el orden es aproximado (por vencimiento y luego por id), no estricto por agregado, porque un reintento cede el paso; la separación en `main.worker.ts` sigue pendiente.
- **Idempotencia de los manejadores con efecto externo (R2a)**: la tabla `outbox_deliveries` (migración 0019: organización, id del evento, nombre del manejador; clave primaria con la organización primero y aislamiento por filas) guarda un acuse por efecto entregado y por destinataria (la clave del manejador lleva el id de la destinataria, de modo que un reintento solo repite lo pendiente). El manejador consulta el acuse antes de actuar y lo anota DESPUÉS de lograr el efecto, en una transacción independiente (`UnitOfWork.runIndependent`), de modo que sobrevive si la transacción del trabajador se revierte (plazo vencido, conexión perdida) y el reintento no repite el efecto. No tiene clave foránea hacia `outbox_events` porque el trabajador retiene `FOR UPDATE` sobre esa fila y la escritura va en otra conexión (se bloquearían). Queda una ventana mínima (caída entre el envío y la anotación) donde un efecto puede repetirse: para avisos de seguridad se prefiere un duplicado a una alerta perdida. El primer manejador es el aviso del ADR 0031 (`credential.reveal_limit_exceeded`).
- **Aviso de segundo factor sin confirmar (N1a)**: segundo manejador real (`credential.totp_pending_unconfirmed`). Lo produce un barrido periódico dentro del sondeo (no hay un trabajo aparte ni variable propia: corre con `OUTBOX_WORKER_ENABLED`, como máximo cada 5 minutos) que, por organización y con `TenantScope.runAs`, reclama los registros de `credential_totp` pendientes desde 24 horas o más y sin `pending_notice_at`, marca la columna y escribe el evento en la MISMA transacción (así el aviso se encola una sola vez por registro pendiente). El manejador avisa solo a quien registró, con acuse por destinataria (`vault.pending-totp-notice:<id>`), tras comprobar que el registro siga pendiente. No requiere migración (la columna y el índice parcial son de la 0018). El payload lleva solo ids y una fecha. Sin auditoría del barrido: es mantenimiento del sistema sin actor, como la purga (ADR 0038); decisión abierta anotada en `odd/tasks/phase-1b-worker.md`. Estado: implementado, pruebas escritas sin ejecutar.
- **Operación (SQL manual, con el rol de administración)**: inspeccionar la cuarentena y reencolar.

  ```sql
  -- Eventos en cuarentena (sin contenido, solo metadatos).
  select id, organization_id, type, attempts, created_at
    from outbox_events
   where published_at is null and next_attempt_at = 'infinity';

  -- Reencolar uno (o quitar el filtro de id para todos) tras corregir la causa.
  update outbox_events
     set next_attempt_at = now(), attempts = 0
   where published_at is null and next_attempt_at = 'infinity' and id = '<id del evento>';
  ```

- **Pendiente**: política de retención de eventos publicados y de sus acuses en `outbox_deliveries` (G1; los acuses no se pueden borrar con el rol de la aplicación hasta decidirlo). Propuesta NO definitiva, para decisión del dueño: borrar los publicados a los **7 días** y conservar siempre los que están en cuarentena hasta revisión humana.
