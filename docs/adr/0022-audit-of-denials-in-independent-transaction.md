# ADR 0022: Auditoría de negaciones en transacción independiente

- **Estado**: Aceptada (implementada en la fase 1a)
- **Fecha**: 2026-10-26 (propuesta); 2026-10-27 (aceptada)
- **Referencias**: [`plan.md`](../../plan.md) secciones "Motor de decisión" y "Auditoría"; [`docs/backend.md`](../backend.md) §5.2 y §16; [ADR 0016](0016-append-only-audit-hash-chain.md).
- **Implementación**: se adoptó la opción 1. La unidad de trabajo (`apps/api/src/modules/organization/infrastructure/pg-unit-of-work.ts`) ofrece una ejecución independiente sobre un pool propio y pequeño, distinto del de las peticiones, para evitar un bloqueo por agotamiento de conexiones. El motor de autorización (`apps/api/src/modules/access/application/authorizer.ts`) registra con ella cada negación, con su código de motivo, antes de que la transacción de la acción se revierta, y expone el mismo camino a las reglas de negocio que niegan fuera del motor (matriz de creación y no escalamiento de roles). Queda abierto lo que este ADR dejó como pendiente: la agrupación o el límite de negaciones repetidas, y el comportamiento si la escritura de la negación falla (hoy el error se propaga a la petición en lugar de degradarse a una alerta).

## Contexto

El plan establece dos reglas que chocan:

- La auditoría se escribe en la **misma transacción** que la acción, y si falla, la acción falla (falla cerrada).
- **Las negaciones también se auditan**, con su código de motivo; un patrón de negaciones repetidas es una señal de abuso.

Cuando el motor niega una acción, el caso de uso devuelve un error y la transacción se revierte; el evento de negación escrito en esa misma transacción se perdería. Por otro lado, una negación no tiene una acción que proteger: el requisito es no perder el rastro.

## Opciones

1. **Transacción independiente para negaciones** (recomendada). Al negar, se registra el evento en una transacción propia, con su propio `SET LOCAL app.org_id`, después de revertir la de la acción (o en paralelo, en otra conexión). Se mantiene la falla cerrada para las acciones permitidas; para las negaciones, si falla la escritura se responde igualmente la negación y se emite una alerta y métrica, porque ya se está denegando.
2. **Escribir la negación antes de evaluar, con un savepoint**: iniciar la acción y registrar la negación en un savepoint que sobreviva al rollback de la acción. PostgreSQL revierte los savepoints con la transacción completa, así que no resuelve el problema _(inferida del plan)_.
3. **Cola o outbox para las negaciones**: encolar el evento y que el worker lo escriba en `audit_events`. Es fiable si el encolado ocurre fuera de la transacción revertida, pero la cadena de hashes se escribiría de forma diferida y fuera de la misma operación _(inferida del plan)_.
4. **No auditar negaciones en base de datos y solo registrarlas como métrica**: contradice el plan. Descartada.

## Recomendación

Opción 1: una transacción independiente y corta dedicada a negaciones, tras la reversión de la acción, que reutilice `AuditLog.record()` y la cadena de hashes de la organización. Hay que decidir (y documentar) el comportamiento si esa escritura falla: la recomendación es **no convertir una negación en un error 5xx**, sino alertar con severidad alta (la falla al escribir auditoría ya es una alerta crítica en el plan), porque la acción ya fue denegada.

Dos riesgos a vigilar: una ráfaga de negaciones puede inflar la tabla y competir por el advisory lock de la organización (ver [ADR 0023](0023-audit-advisory-lock-and-long-transactions.md)), por lo que conviene un rate limit o agrupación de negaciones repetidas.

Esta recomendación pasó a ser la decisión al aceptarse el ADR; el texto original se conserva como contexto de la elección.

## Consecuencias (si se acepta la recomendación)

- **Positivas**: ninguna negación se pierde por el rollback; el patrón de abuso queda visible.
- **Negativas o costos**: una segunda transacción por negación; una regla de excepción a la "falla cerrada" para este caso; posible amplificación por ataques de fuerza bruta.
- **Pendiente**: la prueba de integración con base de datos real que verifique que una negación sobrevive al rollback de la acción (la agrupación se resolvió en la adenda de abajo).

## Adenda (2026-10-28): agrupación de negaciones repetidas

El dueño aprobó agrupar las negaciones repetidas ("Agrupamos de una vez"). Decisión implementada en `DenialGrouper` (`apps/api/src/modules/access/application/denial-grouper.ts`), usada por el motor al auditar:

- **Clave del grupo**: organización, actor, código de motivo, permiso y usuario objetivo. La organización forma parte de la clave porque cada una tiene su propio rastro: una negación anónima en una no puede ocultar la misma en otra.
- **Ventana de 60 s**. La primera negación de cada clave en la ventana siempre se audita. Las repetidas no escriben evento: se cuentan y el total viaja en el siguiente evento auditado de esa clave como `suppressedCount` (campo añadido a la lista blanca de `authz.denied`). La acción sigue negándose siempre; solo se agrupa el rastro.
- **Falla cerrada**: la ventana se abre solo después de que el evento se escribió. Si la escritura falla o devuelve error, la siguiente negación idéntica vuelve a intentarlo.
- **Reloj**: si el reloj retrocede, la ventana se considera vencida; no se silencian negaciones sin límite.
- **Memoria acotada** a 10 000 claves (se descartan las más antiguas) y solo en la instancia única (ADR 0039).
- **Límite conocido**: el conteo de repetidas es de mejor esfuerzo. Se pierde si la clave no vuelve a negarse, si el proceso se reinicia o si la clave se expulsa por el tope. La primera negación nunca se pierde. Vaciar el conteo con un temporizador exigiría auditar fuera de una petición y queda como mejora pendiente.
- **Sigue abierto**: el comportamiento si la escritura de la negación falla (hoy el error se propaga a la petición en lugar de degradarse a una alerta).
