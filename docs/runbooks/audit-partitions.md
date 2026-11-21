# Runbook: Particiones de auditoría

> **Borrador, pendiente de ensayo en staging.** La tabla `audit_events` está particionada por mes ([ADR 0024](../adr/0024-audit-retention-vs-revoke-delete.md), migración `0046`).

## Objetivo

Que siempre exista la partición del mes en curso y de los meses siguientes. Un mes sin partición hace fallar todo insert de auditoría y, con él, toda acción que deba auditarse: la plataforma deja de operar.

## Crear particiones

La migración deja la partición legada más 24 meses por adelantado. Con el rol de migraciones (nunca `iam_app`, que no puede ejecutarla), crear el mes siguiente al último existente:

`select audit_create_month_partition('AAAA-MM-01');`

- El argumento debe ser el primer día de un mes; la función devuelve el nombre `audit_events_pAAAAMM`.
- Si la partición ya existe devuelve su nombre; si el mes ya lo cubre otra partición (el mes de la migración lo cubre la legada) falla con `22023`.
- Cada partición nace con `FORCE RLS`, sus dos políticas, el disparador de `TRUNCATE`, índices únicos propios y sin permisos para `iam_app`.
- Conviene hacerlo en una ventana de poco tráfico: crear la partición toma bloqueos sobre la tabla padre (a confirmar en el ensayo en staging).

## Alerta de margen

Programar una tarea que avise cuando queden menos de **6 meses** de partición por delante. Pendiente de programar (Ops).

## Verificación diaria de la cadena

`seq` ya no es único por restricción en toda la base: lo garantizan el candado por organización y `audit_verify_chain()`. Ejecutar `audit_verify_chain()` cada día por organización; cualquier valor distinto de nulo es un `seq` repetido, saltado o un hash roto, y se trata como incidente ([compromiso](compromised-user-or-server-response.md)). Pendiente de programar (Ops).

## Fallo en el límite de mes

Un insert que espere el candado de su organización a través de la medianoche UTC del día 1 puede fallar con `23514` (el evento se enruta al mes que termina y se fecha en el siguiente). La aplicación debe reintentarlo; la ocurrencia es rara.
