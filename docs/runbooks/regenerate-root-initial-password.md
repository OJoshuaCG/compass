# Runbook: Regenerar la contraseña inicial extraviada de la Raíz

> **Borrador, pendiente de ensayo antes de producción.** **No existe un comando propio** para regenerar la contraseña inicial (`provision-organization.md` lo dice). Este runbook describe las dos salidas reales de hoy y marca **por definir** lo que falta.

Referencias: [Dar de alta una organización](provision-organization.md); [Recuperar a la Raíz](recover-root.md); [ADR 0037](../adr/0037-root-recovery-dual-custody.md); [ADR 0027](../adr/0027-emergency-codes-root-reset-model.md).

## Objetivo

Que la Raíz recién dada de alta, que perdió o nunca recibió su contraseña inicial, pueda entrar y cambiarla. Estado final: la Raíz tiene una contraseña de un solo uso conocida solo por ella y la cambia al entrar.

## Qué hay que saber

- El comando de alta imprime **una sola vez** la contraseña inicial (24 caracteres en grupos de 6, de un solo uso, con cambio obligatorio) y los ocho códigos de emergencia. **No se pueden volver a mostrar.**
- La Raíz recién dada de alta queda en estado `invited` hasta que entra y cambia la contraseña.
- Una Raíz que **ya** cambió su contraseña no entra aquí: use [Usar un código de emergencia](use-emergency-code.md) (conserva contraseña) o [Recuperar a la Raíz](recover-root.md) (perdió todo).

## Cuándo usarlo

- La contraseña inicial no se anotó, se perdió la salida del comando o se entregó a quien no debía.
- La Raíz nunca llegó a entrar.
- **No sirve** si la Raíz ya completó su primer acceso.

## Precondiciones

- Acceso de operaciones a la conexión de administración (`PROVISION_DATABASE_URL`). La API nunca ejecuta estos comandos.
- Saber **si se conservan los códigos de emergencia** de los dos custodios (grupos A y B).
- Identidad de la Raíz y motivo verificados por un canal independiente.
- Canal seguro para entregar la contraseña nueva (**por definir**: decisión C8 del `TODO.md`).

## Pasos

Elige la salida según el caso.

### Salida 1: se conservan los códigos de los dos custodios

1. Comprueba que la organización se dio de alta **después** de la migración 0013 (sus códigos tienen custodio asignado). Las anteriores las rechaza el comando.
2. Convoca a los dos custodios y sigue [Recuperar a la Raíz](recover-root.md): el comando `recover-root` genera una **contraseña inicial nueva**, deja a la Raíz en `invited` y reemite los ocho códigos.
3. Confirma con el equipo (**por confirmar** y ensayar) que el comando acepta a una Raíz que nunca había entrado: su estado `invited` lo permite, pero no está probado como caso propio.
4. Entrega la contraseña a la Raíz por el canal seguro y destruye los papeles de los códigos viejos.

### Salida 2: no se conservan los códigos, o los custodios no están

1. **Si la organización no tiene uso** (sin personas invitadas, sin cuentas, sin secretos): descártala y repite el alta con otro identificador (`ORG_SLUG` distinto) siguiendo [Dar de alta una organización](provision-organization.md). Descartar la organización exige **intervención directa en la base de datos** (procedimiento **por definir**: hoy no está documentado ni ensayado). Obtén la autorización de la dirección y registra qué se borró.
2. **Si la organización ya tiene datos**: no la descartes. No hay recuperación dentro del sistema sin los códigos; es el caso de la **caída total** ([Caída total con sobres sellados](total-outage.md), paso 7) y requiere administración directa de la base de datos (**por definir**).
3. En ambos casos, ninguna persona con rol de Administrador puede restablecer a la Raíz.

## Verificación

- La Raíz entra con la contraseña de un solo uso y se le obliga a cambiarla.
- La auditoría tiene el evento correspondiente (`auth.root_recovered` en la salida 1; el alta nueva en la salida 2).
- La contraseña vieja y los códigos viejos ya no sirven.
- La salida del comando se limpió de la pantalla y del historial del shell.

## Rollback

- El comando de recuperación es atómico: si falla, vuelve a ejecutarlo.
- Si se perdió la nueva contraseña antes de entregarla, repite la salida elegida (la contraseña no se puede recuperar); en la salida 1 consume códigos de los custodios, así que confirma que les quedan vigentes.
- Una organización descartada no se recupera: solo con el respaldo de la base ([Restaurar respaldo](restore-backup.md)).

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Operaciones | Ejecuta los comandos con la conexión de administración y entrega la contraseña |
| Custodios A y B | Aportan sus códigos en la salida 1 |
| Dirección o dueño de la organización | Autoriza descartar una organización sin uso |
| Raíz | Entra, cambia la contraseña y registra sus factores |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
