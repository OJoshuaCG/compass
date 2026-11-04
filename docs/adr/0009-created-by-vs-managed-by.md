# ADR 0009: `created_by` inmutable separado de `managed_by` transferible

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) reglas 3, 4, 5, 7 y 8 de jerarquía; tabla `users`; [`docs/database.md`](../database.md).

## Contexto

Quien crea a un usuario no necesariamente debe gestionarlo para siempre: las personas se van, cambian de rol o de equipo. Si autoridad y autoría fueran el mismo dato, las bajas dejarían usuarios huérfanos.

## Decisión

Dos columnas en `users`: `created_by` es inmutable y solo sirve para auditoría; `managed_by` define la autoridad y es transferible. La transferencia la ejecuta quien gestiona a T; el nuevo responsable M debe ser el propio actor o estar en su subárbol, y cumplir `M.rango < T.rango`. Al desactivar a U, sus subordinados directos pasan al responsable de U en la misma transacción (a la Raíz si U era Administrador).

## Alternativas consideradas

- **Una sola columna (creador = responsable)**: descartada porque las bajas dejarían usuarios sin responsable.
- **Borrar usuarios o reasignar en cascada** _(inferida del plan)_: descartada porque el plan prohíbe borrar usuarios (regla 8) para conservar la integridad de la auditoría.

## Consecuencias

- **Positivas**: bajas sin huérfanos; auditoría fiel de quién invitó a quién.
- **Negativas o costos**: dos relaciones que mantener consistentes; la reasignación debe ser atómica con la baja.
- **Verificación**: pruebas de dominio de transferencia y de reasignación en `DeactivateUser`; `created_by` sin camino de actualización.

## Enmienda (2026-11-04): qué pasa con las cuentas cuando su responsable se va

Esta enmienda no reemplaza lo decidido arriba: lo amplía. Hasta aquí la baja solo reasignaba a los subordinados directos; las cuentas de la bóveda que la persona gestionaba quedaban igual. El estado es **decidida, aún no construida**; la construcción sigue en `odd/tasks/owner-decisions-2026-11-04.md` (T3).

- **Decisión del dueño (S3):** «4.0. Si, quitar las 2», «4.1. Opcion B», «4.2. Opcion A, pero no podriamos asignarlo al admin mas cercano?», «4.3. Si», «4.4. Opcion A», «4.5. Opcion A», y la confirmación «Si, es correcto, asignar y notificar o si no se puede , tambien alertar».
- **Regla:** al dar de baja a una persona, las cuentas cuyo único responsable activo era ella se asignan, subiendo por la cadena de superiores, a la primera persona que ya tenga por sí misma los permisos de compartir, editar credenciales y gestionar la rotación y esté en la rama de quien da la baja. Si nadie de la rama califica, la cuenta pasa al Administrador más cercano hacia arriba que tenga esos permisos, aunque esté fuera de la rama, y se le notifica. Si no hay ninguno, la cuenta queda sin responsable y se alerta a Administradores y Raíz. Detalle en [`docs/business/governance.md`](../business/governance.md) §2.4.
- **Qué se descartó:** el paso «persona del mismo nivel» (el sistema elegiría a quien recibe secretos sin autoridad jerárquica ni criterio repetible; la cadena de superiores siempre termina en la Raíz activa) y mantener vivo el perfil de quien se va (contradice cortar sesiones y accesos).
- **Por qué los permisos se exigen ya concedidos:** en la bóveda nadie comparte más que su propio nivel. Conceder la responsabilidad a alguien sin esos permisos se saltaría ese doble control.
- **Qué se deja igual:** suspender no reasigna nada; la persona suspendida conserva su responsabilidad y sus comparticiones.
- **Rotación:** en la baja se rotan todas las credenciales vivas de las cuentas donde la persona tuvo acceso de ver o más (no solo las reveladas en 180 días), en 72 horas y con prioridad alta para las que reveló. Cada tarea tiene siempre asignatario; si no hay otro, la Raíz.
- **Ejecución:** síncrona, en la misma transacción de la baja. Primero el bloqueo de jerarquía, luego las cuentas ordenadas por identificador y la auditoría por cuenta después del último bloqueo de cuenta. El sistema mide cuánto tarda; si la medición lo pide, parte del trabajo pasará a un proceso posterior, cerrando siempre de inmediato las sesiones y el estado de la persona.
- **Dónde vive:** el puerto en `directory`; los adaptadores en `vault` (cuentas, comparticiones y rotación) y `access` (permisos del candidato), cableados en el contenedor. `directory` no importa ninguno de los dos.
