# ADR 0003: PostgreSQL como única fuente de verdad

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) secciones "Decisiones cerradas (ADR)", "Stack tecnológico" y "Modelo de dominio y de datos"; [`docs/database.md`](../database.md).

## Contexto

El producto necesita transacciones que abarquen acción, auditoría y eventos (outbox), aislamiento por organización en la base de datos (RLS) y almacenamiento flexible de la configuración de plataformas (`login_strategy`, `mail_rules`).

## Decisión

PostgreSQL 16 o superior es la única fuente de verdad del dominio. Redis se usa solo para contadores, límites, colas y sesiones calientes, y nunca guarda material criptográfico. El acceso a datos usa Drizzle ORM con migraciones SQL versionadas en `db/migrations`.

## Alternativas consideradas

- **Almacenes adicionales como fuente de verdad (documentos, clave-valor)** _(inferida del plan)_: descartados porque no ofrecen las transacciones ni RLS que el diseño exige y fragmentarían la consistencia.
- **Redis como almacén de sesiones o secretos**: el plan lo limita a contadores y sesiones calientes, y prohíbe material criptográfico.

## Consecuencias

- **Positivas**: transacciones atómicas entre acción, auditoría y outbox; RLS nativa; JSONB para configuración.
- **Negativas o costos**: la base de datos es punto único de verdad y requiere respaldo y restauración ensayados (ver [runbook de restauración](../runbooks/restore-backup.md)); la generación de UUIDv7 se hace en la aplicación porque PostgreSQL 16 no la trae (`docs/backend.md` §2 y §16).
- **Verificación**: pruebas de integración con PostgreSQL real vía Testcontainers.
