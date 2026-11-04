# ADR 0048: Transferencia de la Raíz con espera de 72 horas y reemisión de los códigos de emergencia

- **Estado**: Aceptada
- **Fecha**: 2026-11-04
- **Referencias**: [`plan.md`](../../plan.md) reglas 9 y 10 de jerarquía, [ADR 0007](0007-four-actors.md), [ADR 0035](0035-outbox-at-least-once.md), [ADR 0037](0037-root-recovery-dual-custody.md), [`governance.md`](../business/governance.md), [`runbooks/transfer-root.md`](../runbooks/transfer-root.md).

## Contexto

La Raíz puede traspasar la titularidad a un Administrador (decisión del dueño, J3). Al completarse hay que decidir qué pasa con los códigos de emergencia que los dos custodios conservan: pertenecían a la Raíz anterior, que ya no es Raíz, y seguirían sirviendo para recuperar a una cuenta que perdió ese rango.

## Decisión

- Las 72 horas corren desde la **aceptación** de la persona destino. Una propuesta no aceptada caduca a los 7 días. Hay una sola transferencia abierta por organización.
- Al completarse, la Raíz anterior queda como Administradora activa (rango 1), pierde el rol Root, sus sesiones y sus factores (debe registrarlos de nuevo).
- Al completarse se **anulan todos los códigos de emergencia vigentes** de la organización. Mientras no se emitan nuevos **no hay recuperación de emergencia**, y el correo de cierre lo advierte.
- Operaciones emite los nuevos con el comando `reissue-emergency-codes`, repartidos entre los dos custodios como en el alta (mitad por grupo). El comando se niega si todavía hay códigos vigentes: sustituir unos códigos que los custodios conservan es trabajo de la recuperación (ADR 0037), no de la reemisión.
- Un proceso periódico (`complete-root-transfers`) completa la espera terminada y cancela sola la transferencia si la persona destino dejó de ser Administradora activa. Toda cancelación o caducidad avisa a la Raíz, a la destinataria y a los Administradores.

## Alternativas consideradas

- **Conservar los códigos viejos**: descartada; darían a los custodios una vía de recuperación sobre una cuenta que ya no es Raíz.
- **Emitir los códigos nuevos dentro de la transferencia**: descartada; el sistema no puede entregarlos a los custodios por un canal seguro y se mostrarían en una petición HTTP. _(inferida del plan)_
- **Reemisión que sustituya códigos vigentes**: descartada; evita que un error de operación deje a los custodios con papeles inservibles sin que lo sepan.

## Consecuencias

- **Positivas**: ninguna vía de recuperación sobrevive al cambio de titular; la reemisión queda auditada (`auth.emergency_codes_reissued`, solo conteo).
- **Negativas o costos**: hay una ventana sin recuperación de emergencia entre el cierre y la reemisión; operaciones debe ejecutar el comando de inmediato.
- **Verificación**: pruebas de la transferencia (`manage-root-transfer.test.ts`), de los avisos y del comando; revisión humana de las pruebas marcadas SENSIBLE.
