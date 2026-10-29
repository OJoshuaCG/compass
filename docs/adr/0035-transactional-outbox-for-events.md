# ADR 0035: Eventos mediante bandeja de salida transaccional

- **Estado**: Aceptada (2026-10-27). Trabajador implementado dentro de la API (2026-10-28, tarea H1a); sin manejadores reales y con la retención de publicados pendiente
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
- **Implementado (H1a)**: módulo `apps/api/src/modules/outbox/`. Un manejador por `type` (`OutboxHandlerRegistry.register`); cada evento se procesa en su propia transacción con el `app.org_id` de su organización (mismo recorrido que la purga, ADR 0038), de modo que un manejador no puede leer otros inquilinos. Si el manejador falla, su transacción se revierte y el intento se anota aparte: espera exponencial de 30 s con tope de 1 h y 8 intentos como máximo. Agotados los intentos, el evento queda sin publicar con `next_attempt_at = 'infinity'` (cuarentena; el esquema no tiene columna de estado y no se agregó migración). Cada manejador tiene un plazo de 30 s por evento: si vence, cuenta como fallo (`OUTBOX.HANDLER_TIMEOUT`) y se revierte la transacción (JavaScript no cancela el manejador, que debe ser idempotente). Un tipo **sin manejador NO cuenta intentos ni entra en cuarentena**: queda pendiente y se reprograma al tope de la espera (1 h), con un aviso por pasada y tipo (`OUTBOX.UNKNOWN_TYPE`, solo nombre del tipo y conteo). Así un evento escrito antes de que exista su manejador (p. ej. el aviso del límite de reveladas de la bóveda) no se pierde. El trabajador comprueba además que el evento reclamado pertenezca a la organización del ámbito; si no, no lo procesa y cuenta la organización como fallida. El apagado ordenado termina la pasada tras el evento en curso y espera como máximo 35 s. El contenido (`payload`) nunca se registra. Se activa con `OUTBOX_WORKER_ENABLED=true` (apagado por defecto).
- **Limitaciones conocidas**: el código de fallo solo se registra en el log (no hay columna donde guardarlo; una columna `last_error_code` exigiría una migración); cada pasada abre al menos una transacción por organización; el orden es aproximado (por vencimiento y luego por id), no estricto por agregado, porque un reintento cede el paso; aún no hay manejadores reales ni separación en `main.worker.ts`.
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

- **Pendiente**: política de retención de eventos publicados (G1). Propuesta NO definitiva, para decisión del dueño: borrar los publicados a los **7 días** y conservar siempre los que están en cuarentena hasta revisión humana.
