# ADR 0031: Límite de revelaciones por usuario

- **Estado**: Aceptada (2026-10-27). Límite implementado en b3fa673 (B2a); aviso por correo a la Raíz implementado en R2a (2026-10-28) con el trabajador del ADR 0035. Sin ejecutar aún las pruebas de R2a (ver "Pendiente")
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
- **Implementado (2026-10-28, B2a)**: conteo desde la auditoría con bloqueo por persona antes del de auditoría, evento crítico y aviso en la bandeja de salida una vez por ventana, prueba de concurrencia (20 solicitudes con 5 de cupo). El valor 30 es una constante, aún no configurable por organización.
- **Implementado (2026-10-28, R2a)**: al superar el tope, la misma transacción que niega y audita deja un evento `credential.reveal_limit_exceeded` en `outbox_events`, una vez por ventana. Su contenido son solo ids y números (id de la persona, tope, conteo, ventana en segundos y hora); nunca la credencial, la cuenta ni el motivo. Un manejador del trabajador (`NotifyRevealLimitExceeded`) envía el correo a la Raíz activa con el puerto de correo existente, en el idioma de la Raíz (es-MX o en-US). El correo nombra a la persona (nombre visible, leído del directorio al enviar), el tope, el conteo y la hora en UTC; no lleva enlaces, nombres de cuentas ni de credenciales. Es idempotente por el id del evento y por Raíz destinataria mediante un acuse en `outbox_deliveries` (migración 0019).
- **Decisiones abiertas de R2a** (se aplicó la opción más conservadora; ver `odd/tasks/phase-1b-worker.md`): (1) el negocio no dice qué datos lleva el correo; se incluye el nombre de la persona y se omite todo lo de la credencial; (2) si la organización no tiene una Raíz activa, el evento no se da por entregado: se reintenta y, agotados los intentos, queda en cuarentena para revisión humana (no se avisa a los Administradores); (3) el aviso se envía una vez por ventana, no por cada intento negado.
- **Pendiente**: confirmar el valor 30 con el negocio y hacerlo configurable por organización.
