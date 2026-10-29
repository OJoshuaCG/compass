# ADR 0035: Eventos mediante bandeja de salida transaccional

- **Estado**: Aceptada (2026-10-27). La implementación queda pendiente
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
- **Pendiente**: implementar escritor y trabajador; política de retención.
