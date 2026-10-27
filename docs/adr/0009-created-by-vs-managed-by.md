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
