# Runbook: Particiones de auditoría

> **Borrador, pendiente de ensayo en staging.** La tabla `audit_events` está particionada por mes ([ADR 0024](../adr/0024-audit-retention-vs-revoke-delete.md), migración `0046`).

## Objetivo

Que siempre exista la partición del mes en curso y de los meses siguientes. Un mes sin partición hace fallar todo insert de auditoría y, con él, toda acción que deba auditarse: la plataforma deja de operar.

## Crear particiones

La migración deja la partición legada más 24 meses por adelantado. Con el rol de migraciones (nunca `iam_app`, que no puede ejecutarla), crear el mes siguiente al último existente:

`select audit_create_month_partition('AAAA-MM-01');`

- El argumento debe ser el primer día de un mes; la función devuelve el nombre `audit_events_pAAAAMM`.
- Si la partición del mes ya existe y está adjunta a `audit_events` con exactamente el rango de ese mes, devuelve su nombre. Si el mes ya lo cubre otra partición (el mes de la migración lo cubre la legada), o si el nombre `audit_events_pAAAAMM` está ocupado por algo que no es esa partición (una tabla común, una partición separada o una con otro rango), falla con `22023`.
- Ante un `22023` por nombre ocupado: revisar qué es esa relación (`\d audit_events_pAAAAMM`) y, si no tiene datos de auditoría que conservar, renombrarla o eliminarla con el rol de migraciones antes de repetir la llamada. Una partición creada a mano no recibe los índices únicos, `FORCE RLS` ni los permisos de la función: créala siempre con ella.
- Dos llamadas simultáneas para el mismo mes pueden hacer que una falle con «la relación ya existe»; repetir la llamada, que entonces devuelve el nombre.
- Cada partición nace con `FORCE RLS`, sus dos políticas, el disparador de `TRUNCATE`, índices únicos propios y sin permisos para `iam_app`.
- Conviene hacerlo en una ventana de poco tráfico: crear la partición toma bloqueos sobre la tabla padre (a confirmar en el ensayo en staging).

## Alerta de margen

Programar una tarea que avise cuando queden menos de **6 meses** de partición por delante. Pendiente de programar (Ops).

## Verificación diaria de la cadena

`seq` ya no es único por restricción en toda la base: lo garantizan el candado por organización y `audit_verify_chain()`. Ejecutar `audit_verify_chain()` cada día por organización; cualquier valor distinto de nulo es un `seq` repetido, saltado o un hash roto, y se trata como incidente ([compromiso](compromised-user-or-server-response.md)). Pendiente de programar (Ops).

## Fallo en el límite de mes

Un insert que espere el candado de su organización a través de la medianoche UTC del día 1 puede fallar con `23514` (el evento se enruta al mes que termina y se fecha en el siguiente). La aplicación debe reintentarlo; la ocurrencia es rara.

## Ensayo local de la migración (2026-11-21)

Una sola corrida en PostgreSQL 18 (contenedor local), 2 000 000 de eventos sintéticos (4 organizaciones, cadena válida generada por el disparador real), sin red. No sustituye el ensayo en staging con datos reales.

| Medida | Antes | Después (25 particiones) |
| --- | --- | --- |
| Migración `0046` completa | n/a | 7,8 s |
| Bloqueo máximo visto por una consulta a `audit_events` durante la migración | n/a | 7,8 s (toda la migración) |
| `audit_verify_chain()` con 500 000 eventos de una organización | 9,4 s | 6,7 s |
| Insert de un evento (media / p95) | 5,6 ms / 23 ms | 4,5 ms / 8,5 ms |

- La migración corre en una sola transacción: durante todo ese tiempo `audit_events` no responde (ni lectura ni escritura). Con 2 millones de eventos son unos 8 s; con más volumen crece, probablemente de forma lineal (suposición, no medida). Conviene correrla en una ventana de mantenimiento.
- No se observó degradación del insert ni de `audit_verify_chain()` con 25 particiones. Los eventos de la prueba están todos en la partición legada, así que no mide el reparto entre varias particiones con datos. Es una sola corrida, con ruido.
- No se midió el bloqueo de `audit_create_month_partition` en línea (sigue pendiente en staging).
