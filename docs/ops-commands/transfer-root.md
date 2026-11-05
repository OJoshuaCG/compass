# Comandos: transferir la Raíz (borrador)

Completa el runbook [transfer-root](../runbooks/transfer-root.md). Leyenda y advertencias en el [README](README.md).

**Aquí no hay comandos que escribir.** La transferencia de la Raíz no está implementada (TODO J3) y esperan siete decisiones de negocio del dueño: cancelación, Administradores huérfanos, aceptación del destino, reemisión de códigos, revocación de la Raíz anterior, plazo de 72 horas y a qué fase pertenece (hoy el runbook la ubica en 1c y los criterios de 1c no la incluyen). Inventar comandos antes de esas respuestas sería escribir el diseño por la puerta de atrás.

| Línea del runbook | Estado | Qué falta |
| --- | --- | --- |
| Paso 1 · Iniciar la transferencia ("interfaz o endpoint: por definir") | **Por definir** | No existe el flujo. Depende de J3. |
| Paso 6 · Regenerar códigos de emergencia de la nueva Raíz ("procedimiento de custodia: por definir") | **Por definir** | Los custodios ya están decididos (C8): dos alias, Compa1 (grupo A) y Compa2 (grupo B). Lo que falta es la operación que emite códigos nuevos sin recuperar a la Raíz: el [ADR 0037](../adr/0037-root-recovery-dual-custody.md) dice expresamente que no está cubierta y que no debe resolverse reduciendo el control dual. |
| Si la nueva Raíz pierde acceso antes de regenerar códigos | **Existe**, con una pregunta abierta | El comando es `recover-root` ([recover-root.md](../runbooks/recover-root.md)). Pregunta abierta, parte de "reemisión de códigos" en J3: tras una transferencia, ¿los códigos de la Raíz anterior siguen sirviendo para la nueva? |

## Mientras J3 no se decida

Si hace falta cambiar de Raíz antes de tener el flujo, el camino que existe hoy es recuperar la cuenta con `recover-root` y tratar el cambio de persona como un caso manual. No lo ensayé; es una consecuencia de lo que dice el ADR 0037, no una verificación.
