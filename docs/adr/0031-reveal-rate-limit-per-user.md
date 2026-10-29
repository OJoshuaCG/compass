# ADR 0031: Límite de revelaciones por usuario

- **Estado**: Aceptada (2026-10-27). La implementación queda pendiente (ver "Pendiente")
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md); [ADR 0022](0022-audit-of-denials-in-independent-transaction.md); [ADR 0023](0023-audit-advisory-lock-and-long-transactions.md); [ADR 0024](0024-audit-retention-vs-revoke-delete.md); `docs/handoff.md` §5 (límite de revelaciones).

## Contexto

Un usuario con acceso legítimo puede revelar contraseñas en masa (cuenta comprometida o persona que se lleva datos). El límite por IP actual vive en memoria y no distingue acciones. Falta un tope por persona sobre la acción más sensible: la revelación.

## Decisión

1. **Tope por usuario y por hora** sobre las revelaciones exitosas (`credential.revealed`). Valor inicial: **30 por hora**, configurable por organización.
2. **La fuente del conteo es la auditoría**: eventos `credential.revealed` con resultado `success` del actor en la última hora (índice `audit_events_org_actor`). No se crea un contador paralelo.
3. **Sin carrera**: la comprobación no puede ser "contar y luego actuar" sin protección, porque dos revelaciones concurrentes podrían pasar ambas con 29. Se toma un `pg_advisory_xact_lock` **por usuario** antes de contar. Orden de bloqueos obligatorio: primero el del usuario, al final el de auditoría (ADR 0023).
4. **Al superar el tope**: la acción se niega con un error de dominio de código estable, la negación se audita (ADR 0022) y se envía un aviso por correo a la Raíz.
5. **Acoplamiento con la retención** (ADR 0024): la política de retención de auditoría debe conservar al menos 1 hora de eventos; de lo contrario el conteo se rompe.

## Alternativas

- **Contador en memoria** (como el límite por IP): descartada; se pierde al reiniciar y no escala a más de una instancia.
- **Tabla de contadores**: _(inferida)_ evita leer auditoría pero duplica la fuente de verdad.
- **Contar después de insertar el evento y revertir si excede**: _(inferida)_ válida, pero retiene el lock de auditoría más tiempo.

## Consecuencias

- **Positivas**: acota el daño de una cuenta comprometida; trazable porque usa la misma auditoría.
- **Negativas**: cada revelación ejecuta una consulta de conteo; una ráfaga de negaciones presiona el lock de auditoría (relacionado con la tarea G6).
- **Pendiente**: implementar (ruta protegida: requiere encargo humano), con prueba de concurrencia; definir el aviso a la Raíz; confirmar el valor 30 con el negocio.
