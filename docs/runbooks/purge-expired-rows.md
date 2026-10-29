# Runbook: Programar la purga de datos efímeros vencidos

> **Borrador, pendiente de ensayo antes de producción.** Deja de aplicar como tarea programada aparte cuando exista el proceso de fondo de la tarea H1, que llamará al mismo caso de uso.

Referencias: [ADR 0038](../adr/0038-background-jobs-traverse-organizations.md); [`docs/database.md`](../database.md) §7.5.

## Objetivo

Que las claves de idempotencia y los desafíos de passkey vencidos no se acumulen. El comando borra, organización por organización y bajo el aislamiento por fila, las filas que vencieron hace más de una hora, e informa cuántas borró por tabla.

## Cuándo usarlo

- En todo despliegue, programado de forma periódica. Propuesta: cada hora.
- A mano, si las tablas `idempotency_keys` o `webauthn_challenges` crecieron porque el comando no se estaba ejecutando.

## Precondiciones

- Las migraciones están aplicadas hasta la `0014` (crea `auth.list_organization_ids()` y concede el borrado de desafíos).
- La API está compilada (`apps/api/dist/main.purge.js`).
- Se tiene la cadena de conexión del rol de la aplicación (`iam_app`), la misma que usa la API. **No** se usa la de administración ni la de migraciones.

## Pasos

1. Define `DATABASE_URL` con la credencial de `iam_app`, cargada desde el gestor de secretos del despliegue (no la escribas en el historial del intérprete).
2. Ejecuta `pnpm --filter @iam/api purge`.
3. Programa ese mismo comando en el planificador de la plataforma (cron, tarea programada del proveedor) cada hora. Es seguro repetirlo y correrlo mientras la API atiende peticiones; no conviene lanzar dos a la vez, aunque no causaría daño (cada lote borra filas distintas o ninguna).
4. Configura una alerta cuando el comando termine con código distinto de cero.

## Verificación

- La salida dice "Purga terminada. Organizaciones recorridas: N" y el número de filas borradas por tabla.
- Una segunda ejecución inmediata borra 0 filas.
- `select count(*) from idempotency_keys where expires_at < now() - interval '1 hour'`, consultado con el contexto de una organización, devuelve 0.

## Rollback y límites

- No hay nada que revertir: solo se borran filas que la aplicación ya trataba como inexistentes (vencidas), y nunca las que vencieron hace menos de una hora.
- Si el comando falla a mitad, lo ya borrado queda borrado y el resto se purga en la siguiente ejecución.
- La purga no escribe en la auditoría (ADR 0038, punto 5): el rastro es la salida del comando y los registros del planificador.
