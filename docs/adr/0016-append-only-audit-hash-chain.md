# ADR 0016: Auditoría append-only con encadenamiento de hashes

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Auditoría"; [`docs/backend.md`](../backend.md) §5.2 y §10; ADR propuestos [0022](0022-audit-of-denials-in-independent-transaction.md), [0023](0023-audit-advisory-lock-and-long-transactions.md) y [0024](0024-audit-retention-vs-revoke-delete.md).

## Contexto

La auditoría es la evidencia de quién accedió a qué. Debe resistir manipulación, incluso por quien administra la base de datos, y no puede perder eventos de acciones sensibles.

## Decisión

Tabla `audit_events` append-only: el rol de la aplicación solo tiene `INSERT` y `SELECT`. Cada evento guarda el hash del anterior de su organización (`prev_hash`, `hash`); un job diario verifica la cadena y alerta si se rompe, y la escritura se serializa por organización con un advisory lock. Se escribe en la **misma transacción** que la acción: si la auditoría falla, la acción sensible falla (falla cerrada). Nunca contiene secretos y `metadata` pasa por una lista blanca. Se auditan también las negaciones con su código de motivo. Exportación periódica a almacenamiento inmutable (por ejemplo, S3 con Object Lock).

## Alternativas consideradas

- **Auditoría asíncrona (best effort)** _(inferida del plan)_: descartada porque permitiría acciones sensibles sin rastro.
- **Tabla mutable sin encadenamiento** _(inferida del plan)_: descartada porque no detectaría reescrituras.

## Consecuencias

- **Positivas**: evidencia verificable; falla cerrada.
- **Negativas o costos**: el lock serializa escrituras por organización (ver [ADR 0023](0023-audit-advisory-lock-and-long-transactions.md)); las negaciones no pueden vivir en la transacción que se revierte (ver [ADR 0022](0022-audit-of-denials-in-independent-transaction.md)); la retención choca con `REVOKE DELETE` (ver [ADR 0024](0024-audit-retention-vs-revoke-delete.md)).
- **Verificación**: prueba por caso de uso del evento exacto; prueba de falla cerrada; verificación de la cadena tras operaciones concurrentes.
