# Runbook: Programar la purga de filas vencidas

> **Borrador, pendiente de ensayo antes de producción.** El comando existe y está probado ([ADR 0038](../adr/0038-purge-expired-ephemeral-rows.md)); la programación en el anfitrión es una propuesta que Ops debe ratificar.

## Objetivo

Que `purge-expired` corra solo, cada hora, para que las tablas efímeras no crezcan sin límite y las versiones del segundo factor reemplazadas se destruyan a los 30 días (`docs/business/two-factor.md` DF-10).

## Qué borra

- Claves de idempotencia y desafíos de WebAuthn vencidos hace más de una hora.
- Versiones del secreto del segundo factor que un re-registro reemplazó hace 30 días o más. Nunca toca la versión vigente, contraseñas ni otros campos.

**No incluye** el outbox: los eventos publicados y sus acuses (`outbox_deliveries`) todavía no se purgan. Borrarlos exige un permiso `delete` para `iam_app` mediante una migración (ruta protegida); está documentado como omitido en `odd/tasks/outbox-hardening.md`. Cuando se implemente, se agendará aquí con el mismo cron (propuesta: una vez al día, con el mismo rol `iam_app`).

No descifra nada, no escribe auditoría (decisión 6 del ADR) y es idempotente: correrlo dos veces seguidas no hace daño.

## Precondiciones

- API compilada: `pnpm --filter @iam/api build` (genera `dist/main.purge-expired.js`).
- `DATABASE_URL` con el **rol de la aplicación** (`iam_app`), el mismo que usa la API. No uses el rol de migraciones ni uno con `BYPASSRLS`: el aislamiento por filas debe seguir vigente.
- Una sola programación activa, en un solo anfitrión. No se probó el solape de dos ejecuciones simultáneas: si una dura más de una hora, revisa por qué antes de dejar que se encimen.

## Programarlo _(propuesta)_

Una vez por hora, con el mismo entorno que la API (el archivo de entorno lo custodia Ops; no lo copies a otro lugar):

```text
17 * * * * cd <ruta de la API> && node dist/main.purge-expired.js >> <ruta de registros>/purge-expired.log 2>&1
```

El minuto `17` evita chocar con otras tareas a la hora en punto. Un temporizador de systemd equivale; lo importante es el intervalo de una hora y que la salida se conserve.

## Salida y alertas

Una línea de conteos: organizaciones recorridas, claves de idempotencia borradas, desafíos borrados, versiones de segundo factor reemplazadas borradas y organizaciones con fallo. No imprime identificadores ni contenido.

- Código de salida `0`: todo en orden.
- Código de salida `1`: alguna organización falló (el motivo sale por stderr con su identificador). Las demás se procesaron. Alerta al equipo de guardia si ocurre en dos ejecuciones seguidas.
- Falta de salida durante más de 2 horas: la programación dejó de correr. Alerta por ausencia.

## Verificación

- Tras la primera ejecución, la línea de conteos aparece en el registro y el código de salida es `0`.
- `idempotency_keys` y `webauthn_challenges` no acumulan filas con vencimiento anterior a hace una hora (consulta con el rol de operación, no con datos de clientes).

## Rollback

Desactivar la entrada del cron. No hay nada que deshacer: lo borrado era efímero o ya había cumplido su retención. Una purga de secretos de segundo factor no se puede revertir; si la política de retención cambia a más de 30 días, ajusta la constante antes de volver a programarla ([ADR 0038](../adr/0038-purge-expired-ephemeral-rows.md), ampliación H1b).

## Historial de ensayos

_Sin ensayos todavía._

> **Pendiente (OPS-1):** la programación en producción descrita en este runbook (cada hora) está pendiente de ratificación por Operaciones.
