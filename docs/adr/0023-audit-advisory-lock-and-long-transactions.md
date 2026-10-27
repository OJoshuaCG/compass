# ADR 0023: Advisory lock de auditoría y transacciones largas

- **Estado**: Propuesta
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Auditoría" (escritura serializada por organización mediante advisory lock); [`docs/backend.md`](../backend.md) §5.2 y §16; [ADR 0016](0016-append-only-audit-hash-chain.md).

## Contexto

Para que la cadena de hashes no se bifurque, el plan serializa la escritura de eventos por organización con un advisory lock, y la auditoría se escribe en la misma transacción que la acción. Si el lock es de transacción (`pg_advisory_xact_lock`), se mantiene **hasta el commit**: toda acción sensible de una organización que audita queda serializada con las demás durante lo que dure su transacción.

Con transacciones largas (por ejemplo, `DeactivateUser`, que revoca sesiones, reasigna subordinados, elimina comparticiones y consulta 180 días de auditoría, o el recifrado por lotes), una sola acción puede bloquear las demás de la misma organización. En una organización única en v1 esto afecta a todo el producto.

## Opciones

1. **Tomar el lock lo más tarde posible** (recomendada como primera medida). Ejecutar la lógica de la acción primero y adquirir el lock solo al calcular y escribir el evento, justo antes del commit, de modo que se mantenga el menor tiempo. Complementar con un `lock_timeout` corto y reintentos acotados.
2. **Separar la reserva de secuencia de la escritura**: una tabla de cabeza de cadena por organización con `SELECT ... FOR UPDATE` en lugar de advisory lock; mismo efecto de serialización, pero visible y con tiempos de espera configurables _(inferida del plan)_.
3. **Cadenas por fragmento** (por ejemplo, por organización y por tipo de evento o partición), verificadas por separado, para reducir la contención _(inferida del plan)_. Complica la verificación e ingesta.
4. **Dividir las acciones largas en pasos cortos** (la baja en varias transacciones coordinadas por outbox). Reduce la ventana pero rompe la atomicidad de la baja que exige el plan. Descartada para `DeactivateUser`.

## Recomendación

Opción 1 más una prueba de carga: medir con transacciones concurrentes la latencia p95 de acciones sensibles y fijar el `lock_timeout` según esa medición; documentar un límite de duración para transacciones que auditan y mover el recifrado de DEK (que no es una acción sensible por evento) fuera de transacciones que mantengan el lock. Evaluar la opción 2 si la contención resulta visible en la medición.

Esta es una recomendación para decidir, no una decisión; los umbrales dependen de la escala esperada, que sigue en las decisiones pendientes del plan.

## Consecuencias (si se acepta la recomendación)

- **Positivas**: la ventana de serialización queda acotada y medible; la cadena sigue sin bifurcarse.
- **Negativas o costos**: el orden de pasos dentro del caso de uso se vuelve parte del contrato (el lock va al final); hay que manejar el timeout (falla cerrada de la acción).
- **Pendiente**: definir el `lock_timeout`, el comportamiento ante timeout y la prueba concurrente de la cadena (ya exigida por el plan).
