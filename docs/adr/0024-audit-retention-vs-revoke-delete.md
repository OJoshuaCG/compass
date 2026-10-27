# ADR 0024: Retención de auditoría frente a `REVOKE DELETE`

- **Estado**: Propuesta
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Auditoría" (append-only, retención de 2 años en línea, exportación a almacenamiento inmutable) y "Decisiones pendientes del equipo" (política de retención); [`docs/backend.md`](../backend.md) §6.1 y §16; [ADR 0016](0016-append-only-audit-hash-chain.md).

## Contexto

El rol de la aplicación solo tiene `INSERT` y `SELECT` sobre `audit_events` (`UPDATE` y `DELETE` revocados) y la cadena de hashes enlaza cada evento con el anterior. El plan fija una retención de **2 años en línea**, más en el archivo. Sin `DELETE` no hay forma de expirar eventos antiguos con el rol de la aplicación, y borrar filas intermedias de una cadena rompería su verificación. La política de retención aún está pendiente de validación con el área legal.

## Opciones

1. **Particionado por tiempo** (recomendada). `audit_events` particionada por mes u organización y fecha; las particiones fuera de la ventana en línea se exportan al archivo inmutable (S3 con Object Lock) y se separan (`DETACH`) o se eliminan por el rol de migraciones o de archivado, no por la aplicación. La cadena se ancla: cada partición cierra con un hash de cierre que la siguiente toma como `prev_hash` inicial verificable contra el archivo.
2. **Rol de archivado dedicado**: un tercer rol, usado solo por un job de archivado, con `DELETE` limitado a eventos ya exportados y verificados, y con anclaje del hash del último evento retirado _(inferida del plan)_. Más simple de introducir, pero deja `DELETE` fila por fila en una tabla append-only y requiere políticas estrictas.
3. **No expirar en línea** y mantener todo en la base de datos: sin riesgo para la cadena, pero crecimiento sin límite y contradice la retención de 2 años en línea. Solo viable si el volumen es bajo _(inferida del plan)_.

## Recomendación

Opción 1, con una verificación de la cadena que pueda iniciar desde un ancla exportada (el job diario de verificación debe saber dónde empieza la cadena en línea). Los pasos exactos de la exportación, el cierre de partición y la verificación del archivo deben quedar en un runbook antes del gate de producción. El plazo de retención final depende de la validación legal (decisión pendiente en el plan).

Esta es una recomendación para decidir, no una decisión.

## Consecuencias (si se acepta la recomendación)

- **Positivas**: expiración eficiente sin `DELETE` desde la aplicación; la cadena y el archivo siguen siendo verificables.
- **Negativas o costos**: complejidad operativa de particiones y anclas; la verificación diaria debe soportar varios segmentos; el esquema de `audit_events` y su RLS deben diseñarse con particionado desde la migración inicial para evitar una migración costosa después.
- **Pendiente**: granularidad de partición, formato del hash de cierre y política de retención validada con el área legal.
