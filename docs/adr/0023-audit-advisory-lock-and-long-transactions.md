# ADR 0023: Advisory lock de auditoría y transacciones largas

- **Estado**: Aceptada (2026-10-27). `lock_timeout` implementado el 2026-10-27 (G6); la medición de latencia queda pendiente (ver "Pendiente")
- **Fecha**: 2026-10-26 (propuesta) · 2026-10-27 (aceptada)
- **Referencias**: [`plan.md`](../../plan.md) sección "Auditoría" (escritura serializada por organización mediante advisory lock); [`docs/backend.md`](../backend.md) §5.2 y §16; [ADR 0016](0016-append-only-audit-hash-chain.md); [ADR 0022](0022-audit-of-denials-in-independent-transaction.md).

## Contexto

Para que la cadena de hashes no se bifurque, el plan serializa la escritura de eventos por organización con un advisory lock, y la auditoría se escribe en la misma transacción que la acción. Si el lock es de transacción (`pg_advisory_xact_lock`), se mantiene **hasta el commit**: toda acción sensible de una organización que audita queda serializada con las demás durante lo que dure su transacción.

Con transacciones largas (por ejemplo, `DeactivateUser`, que revoca sesiones, reasigna subordinados, elimina comparticiones y consulta 180 días de auditoría, o el recifrado por lotes), una sola acción puede bloquear las demás de la misma organización. En una organización única en v1 esto afecta a todo el producto.

## Opciones

1. **Tomar el lock lo más tarde posible**. Ejecutar la lógica de la acción primero y adquirir el lock solo al calcular y escribir el evento, justo antes del commit, de modo que se mantenga el menor tiempo. Complementar con un `lock_timeout` corto.
2. **Separar la reserva de secuencia de la escritura**: una tabla de cabeza de cadena por organización con `SELECT ... FOR UPDATE` en lugar de advisory lock; mismo efecto de serialización, pero visible y con tiempos de espera configurables _(inferida del plan)_.
3. **Cadenas por fragmento** (por ejemplo, por organización y por tipo de evento o partición), verificadas por separado, para reducir la contención _(inferida del plan)_. Complica la verificación e ingesta.
4. **Dividir las acciones largas en pasos cortos** (la baja en varias transacciones coordinadas por outbox). Reduce la ventana pero rompe la atomicidad de la baja que exige el plan. Descartada para `DeactivateUser`.

## Decisión

Se acepta la **opción 1**. En el código ya es así por diseño: el lock se toma dentro del disparador `audit_events_chain` (`db/migrations/0006_governance_audit.sql`), es decir, en el `INSERT` del evento, y no al abrir la transacción.

1. **El evento de auditoría es lo último que escribe una transacción.** Ningún caso de uso hace trabajo después de insertar el evento. Es parte del contrato del caso de uso, no una sugerencia.
2. **`lock_timeout` de 5 segundos** para las transacciones que auditan. Si vence, la acción **falla cerrada** con un error de dominio de código estable, sin exponer detalles internos, y no se ejecuta. El valor es una estimación inicial; se ajusta con la medición de latencia.
3. **El recifrado de DEK por lotes no mantiene el lock.** Corre en transacciones que no escriben auditoría por evento.
4. **Las negaciones** ya se escriben en una transacción independiente y corta ([ADR 0022](0022-audit-of-denials-in-independent-transaction.md)), por lo que retienen el lock solo lo que dura su `INSERT`.
5. **Plan B**: si la medición muestra contención visible, se evalúa la opción 2 (tabla de cabeza de cadena).

## Consecuencias

- **Positivas**: la ventana de serialización queda acotada y medible; la cadena sigue sin bifurcarse.
- **Negativas o costos**: el orden de pasos dentro del caso de uso se vuelve parte del contrato (el lock va al final); hay que manejar el timeout (falla cerrada de la acción).
- **Implementado (2026-10-27, G6)**: `lock_timeout` de 5 s local a la transacción en `PgAuditEventRepository`; el 55P03 se traduce a `AUDIT.LOCK_TIMEOUT` (503), con prueba de integración. El límite no se restablece: el evento debe seguir siendo lo último que escribe cada caso de uso.
- **Pendiente**:
  - Medir con transacciones concurrentes la latencia p95 de las acciones sensibles para confirmar o ajustar los 5 s. Ya existe la prueba de no bifurcación (`db/tests/audit.test.ts`), pero no mide latencia.
  - `DeactivateUser` cumple la regla 1 (verificado el 2026-10-27: la auditoría es el último paso; el bloqueo de jerarquía es un lock aparte y temprano).
  - Decidir cómo se agrupan las negaciones repetidas para que una ráfaga no sature el lock de la organización (el ADR 0022 lo deja abierto).
