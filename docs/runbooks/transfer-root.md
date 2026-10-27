# Runbook: Transferir la Raíz

> **Borrador, pendiente de ensayo antes de producción.** Los comandos y las pantallas concretas están **por definir** (la fase 1c implementa el flujo).

Referencias: [`plan.md`](../../plan.md) reglas 9 y 10 de jerarquía ("Transferencia de Raíz" y "Recuperación de la Raíz"), permiso `org.settings` y "Reautenticación (step-up)"; [ADR 0007](../adr/0007-four-actors.md).

## Objetivo

Traspasar la titularidad de la organización a un Administrador de forma controlada. La Raíz anterior queda como Administrador gestionado por la nueva Raíz. Siempre hay exactamente una Raíz activa por organización.

## Cuándo usarlo

- Cambio planeado de dueño de la organización (salida, rotación de responsabilidades).
- No es el procedimiento para una Raíz sin acceso: para eso se usan los **códigos de emergencia** custodiados (ver "Rollback y recuperación").

## Precondiciones

- La persona destino es un **Administrador** activo de la organización.
- La Raíz actual puede reautenticarse (verificó un factor en los últimos 5 minutos) y el Administrador destino también.
- La Raíz actual tiene el permiso `org.settings` (techo de rango 0).
- Los códigos de emergencia vigentes de la Raíz están identificados y custodiados fuera del sistema por dos personas.
- Se avisó al equipo, porque todos los Administradores recibirán notificación y habrá una espera de 72 horas.

## Pasos

1. La Raíz inicia la transferencia hacia el Administrador elegido; ambos se reautentican. Interfaz o endpoint: por definir.
2. El sistema registra la solicitud como evento de auditoría crítico y avisa a **todos los Administradores**.
3. Espera de **72 horas** (la transferencia es cancelable durante ese periodo).
4. Al cumplirse el plazo y sin cancelación, el sistema completa la transferencia: el Administrador pasa a Raíz; la Raíz anterior pasa a Administrador gestionado por la nueva Raíz. La unicidad de la Raíz activa la protege el índice único parcial.
5. Revocar las sesiones y factores de la Raíz anterior que no deban conservarse y revisar que sus permisos corresponden al nuevo rango (los permisos efectivos se recortan por el techo del rango).
6. **Regenerar los códigos de emergencia** de la nueva Raíz, imprimirlos y entregarlos a dos custodios; destruir los de la Raíz anterior. Procedimiento de custodia: por definir con el equipo (los custodios son una decisión pendiente en el plan).
7. Revisar con la nueva Raíz las políticas de organización (por ejemplo, exigir passkeys a Raíz y Administradores) y los permisos que dependen de `org.settings`.
8. Actualizar la lista de custodios y de personas de guardia.

## Verificación

- Existe exactamente una Raíz activa en la organización, y es la persona destino.
- La Raíz anterior es Administrador, con `managed_by` apuntando a la nueva Raíz.
- Hay eventos de auditoría críticos de solicitud, reautenticación y finalización, y la cadena de auditoría verifica.
- Los Administradores recibieron los avisos.
- Los nuevos códigos de emergencia están custodiados por dos personas y los anteriores fueron destruidos.

## Rollback y recuperación

- **Cancelar**: la transferencia es cancelable durante las 72 horas de espera; la cancelación se audita.
- **Después de completarla**: no hay reversión automática; se requiere una nueva transferencia desde la nueva Raíz hacia un Administrador.
- **Raíz sin acceso**: usar los códigos de emergencia custodiados (usarlos alerta a todos los Administradores y queda auditado) y luego, si corresponde, ejecutar esta transferencia.
- **Si la nueva Raíz pierde acceso antes de regenerar códigos**: escalar a los custodios de los códigos de emergencia existentes y restablecer factores según el procedimiento de recuperación del plan (por definir).

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Raíz actual | Inicia la transferencia y se reautentica |
| Administrador destino | Se reautentica y acepta |
| Administradores | Reciben el aviso y pueden objetar durante la espera |
| Dos custodios | Guardan los códigos de emergencia nuevos |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
