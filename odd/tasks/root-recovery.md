# Recuperación de la Raíz sin contraseña ni factores (G2 / C3)

Objetivo: cerrar el hueco que `docs/handoff.md` §4 punto 4 y el ADR 0027 dejan abierto: la Raíz que olvida su contraseña y pierde sus factores no tiene recuperación en el sistema, y no hay forma de emitir códigos de emergencia nuevos. Decisión de diseño: [ADR 0037](../../docs/adr/0037-root-recovery-dual-custody.md) (aceptada con confirmación pendiente del dueño). Tarea de ClickUp: `1dfm34xyvgp`. Método: iteraciones hasta 5, revisión adversarial ciega con `jd-judge-a` y `jd-judge-b` (rutas protegidas), mutación manual del control dual.

## Specs

Textuales de lo pedido el 2026-10-27: "Adelante con la construccion del adr y proceder con la implementacion del codigo". Y del handoff §4 punto 4: "Procedimiento de operaciones para la Raíz que olvida su contraseña y pierde sus factores, y una forma de emitir códigos de emergencia nuevos."

- S1. Ningún Administrador puede restablecer a la Raíz; solo los dos custodios (ADR 0027).
- S2. Usar un código de emergencia es un evento crítico: se audita y se avisa a los Administradores (`plan.md` regla 10).
- S3. Los códigos se guardan solo como hash; ningún secreto va a registros ni a la auditoría.
- S4. El comando de operaciones usa la conexión de administración y nunca se expone por HTTP.
- S5. Una migración aplicada no se edita: se crea una nueva.

## Tasks

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| T1 ADR 0037 y registro en el índice | S1, S2 | inline | hecha |
| T2 Migración 0013 con el grupo de custodia de los códigos de emergencia | S3, S5 | inline | hecha |
| T3 El alta reparte los códigos en grupos A y B (cuatro y cuatro) | S1 | inline | hecha |
| T4 Caso de uso `RecoverRoot`, almacén Postgres y comando `recover-root` | S1 a S4 | inline | hecha |
| T5 Acciones de auditoría `auth.root_recovered` y `auth.root_recovery_rejected` | S2, S3 | inline | hecha |
| T6 Pruebas: unitarias, integración con base de datos real y denegaciones | S1 a S3 | inline | hecha |
| T7 Runbook `recover-root.md` y referencias cruzadas | S2 | inline | hecha |
| T8 Revisión adversarial, mutación manual y cierre | todas | inline | hecha (queda `simplify` y la confirmación del dueño del ADR) |

## Bitácora

- 2026-10-27: ADR 0037 redactado. Fuera de alcance, por escrito en el ADR: reemisión sin recuperación (transferencia de la Raíz) y el caso de códigos agotados por completo.
- 2026-10-27: Implementación. Formato, compilación, tipos y lint en verde; pruebas dirigidas 49 de 49 (primera pasada con 5 fallos por dos errores de mis propias pruebas: un hasher falso que incrustaba la contraseña y un estado base `active` en una Raíz recién creada, que está `invited`; ambos corregidos sin debilitar aserciones).
- 2026-10-27: Revisión adversarial ciega (`jd-judge-a`, `jd-judge-b`) sobre el mismo alcance. Confirmados por ambos y corregidos: fallo posterior al commit que podía dejar sin salida la contraseña y los códigos nuevos; rechazos sin auditar (ahora `auth.root_recovery_rejected`, `denied`); `rowCount` sin comprobar en contraseña y estado; Raíz suspendida reactivable (ahora solo `invited` o `active`). Hallazgos de un solo juez, no corregidos: diferencia de tiempos entre rechazos, códigos en variables de entorno del proceso y `webauthn_challenges` pendientes sin invalidar.
- 2026-10-27: Mutación manual del control dual (cualquier par de códigos en vez de uno A y uno B): fallaron 2 pruebas (mismo grupo y códigos sin grupo); revertida y 49 de 49 en verde.
