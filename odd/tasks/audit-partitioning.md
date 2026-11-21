# Particionado de `audit_events` (ADR 0024)

Objetivo: convertir `audit_events` en tabla particionada por mes sobre `created_at`, adjuntando la tabla actual como primera partición, sin copiar ni borrar datos. Rama: `main` (autonomía del proyecto). Estrategia de entrega: `ask-on-risk`, sin push. Ejecutor de pruebas: `pnpm --filter @iam/db exec vitest run tests/<archivo>` (contenedor PostgreSQL 18).

## Specs

- **S1** (Jor-El, 2026-11-20, «(a) SÍ»): `seq` deja de ser único en la base de datos, con tres condiciones: «índice único por partición, bloqueo por organización al asignar seq, verificación diaria de la cadena más prueba de concurrencia, incluida una prueba que intente duplicar seq entre particiones».
- **S2** (Jor-El, «(b) SÍ, solo local o staging»): la tabla actual pasa a ser la primera partición con ATTACH, sin copiar ni borrar datos, con un «CHECK de rango validado antes del ATTACH, ensayo previo en copia local o staging, sin DROP, DELETE ni TRUNCATE. Si hay que copiar o borrar datos, para y pregunta».
- **S3** (Jor-El, condición 4): «Migración nueva, nunca editar una ya aplicada. Nada contra producción, ni push ni merge, sin confirmación del dueño.»
- **S4** (Jor-El, condición 1): con el diff de la migración listo, correr `security-review` y `code-review` en high sobre el mismo diff; si coinciden, aplicar en local; si discrepan o aparece algo de credenciales o producción, `judgment-day`; si los jueces no coinciden, parar y avisar al dueño.
- **S5** (ADR 0024, decisión del 2026-11-13): partición mensual con una sola serie global de `seq` por organización; cada partición nace con `ENABLE` y `FORCE ROW LEVEL SECURITY` y sus políticas; un mes sin partición bloquearía la auditoría (falla cerrada), así que hay que crearlas por adelantado.
- **S6** (alcance, supuesto): NO se incluye el retiro de particiones, `audit_chain_checkpoints`, el rol de archivado ni la exportación inmutable; dependen del ancla del ADR 0042 y de la verificación de Wasabi.

## Tareas

| ID | Specs | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1-S3, S5 | inline | hecho: migración `0046` aplicada en pruebas | pendiente |
| T2 | S1, S2 | inline | hecho: 13 pruebas | pendiente |
| T3 | S1 | inline | hecho | pendiente |
| T4 | S4 | revisores | hecho: ver L3 | pendiente |
| T5 | S5 | inline | hecho | pendiente |

## Log

- **L1** (2026-11-20, Jor-El, decisión): «DECISION (a) SÍ y (b) SÍ, solo local o staging.» con las cuatro condiciones de S1 a S4. Antes, el dueño ordenó que la respuesta de Jor-El cuente como decisión (reglas global y del proyecto cambiadas el 2026-11-20).
- **L2** (2026-11-20): mapa de dependencias (explorador): PK `(id)` y `unique (organization_id, seq)` no incluyen `created_at`; el disparador asigna `created_at := clock_timestamp()` (clave de partición) después del enrutamiento; `rls.test.ts` descubre tablas `r` y `p` con `organization_id`; `audit.integration.test.ts` hace `alter table ... disable trigger`; ninguna FK entrante.
- **L3** (2026-11-20): revisión. `security-review`: sin vulnerabilidades de confianza alta. `code-review` (high): 9 hallazgos, aplicados los confirmados (unicidad de `id`, revoke a `iam_app`, idempotencia, comentarios). Como los dos difirieron, se corrió `judgment-day` (`jd-judge-a`, `jd-judge-b`, a ciegas). Coincidieron en: comentario falso sobre la ventana del límite de mes, disparadores clonados sin probar en particiones mensuales y la prueba de `seq` duplicado en la legada que no probaba su índice; los tres corregidos. Solo un juez: la función devuelve éxito para cualquier tabla con ese nombre y el bloqueo de `create table partition of` (no aplicado; queda como nota en el runbook). Ambos: falta una tarea de creación de particiones y alerta (Ops, en el runbook). Decidió el paso 3 de Security Decisions (jueces coinciden, nada pendiente al dueño).
- **L4** (2026-11-20): mutación: sin el índice único por partición fallan 3 pruebas; sin el revoke a `iam_app` falla 1. Pruebas verdes: `audit-partitioning`, `rls`, `audit`, `audit-anchors`, `migrations`. Decisión de Jor-El usada: (a) y (b) (L1), más su respuesta que cuenta como encargo para la ruta protegida.
- **L5** (2026-11-21, Jor-El autorizó A, B y C en orden, solo local, sin push): A hecho. Ensayo local en PostgreSQL 18 con 2 000 000 de eventos sintéticos: migración 7,8 s, bloqueo máximo observado 7,8 s (la migración es una sola transacción), `audit_verify_chain()` 9,4 s antes y 6,7 s después, insert 5,6 ms (p95 23 ms) antes y 4,5 ms (p95 8,5 ms) después. Una corrida; datos solo en la partición legada. Resultados en `docs/runbooks/audit-partitions.md`. El script fue temporal y no se commiteó.

