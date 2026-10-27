# ADR 0029: Idempotencia con reserva y propiedad de la clave

- **Estado**: Aceptada
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) ("Idempotency-Key obligatorio en POST que crean recursos; se guarda la respuesta 24 horas"); [`docs/backend.md`](../backend.md) §7.2.1; [`docs/database.md`](../database.md) §5.5.

## Contexto

Reintentar una petición que crea un recurso no debe crear otro. Guardar la respuesta solo al terminar deja una ventana: dos peticiones iguales y simultáneas pasan ambas. Una petición que cae a mitad podría dejar la clave bloqueada durante un día, y una petición lenta, ya reemplazada por otra, podría sobrescribir la respuesta de la dueña más reciente.

## Decisión

La clave (`Idempotency-Key`, de 8 a 200 caracteres) es obligatoria en los `POST` que crean recursos y es única por organización, actor y clave, con el resumen de la petición guardado.

- **Reserva antes de ejecutar:** la primera petición toma una reserva de 1 minuto con una sola escritura atómica. Otra igual que llega mientras tanto recibe `409 IDEMPOTENCY.IN_PROGRESS`.
- **Propiedad:** la reserva se identifica por su vencimiento. Solo quien la tiene puede completarla o liberarla; una petición lenta ya reemplazada no pisa a la nueva dueña. La reserva vencida se toma de forma atómica.
- **Respuesta guardada 24 horas:** un reintento idéntico recibe la misma respuesta con `Idempotent-Replayed: true`. La misma clave con otra petición responde `422 IDEMPOTENCY.KEY_REUSED`; sin clave, `422 IDEMPOTENCY.KEY_REQUIRED`.
- Las respuestas de error no se guardan y la reserva se libera. Si guardar la respuesta falla después del *commit*, la clave no se libera, para no repetir una creación ya hecha.
- Nunca se aplica a endpoints cuya respuesta lleve secretos, porque la respuesta se guarda tal cual.

## Alternativas consideradas

- **Guardar solo al terminar**: permite que dos peticiones simultáneas ejecuten la acción. Descartada.
- **Bloqueo de base de datos durante toda la petición** _(inferida del plan)_: mantiene transacciones largas y conexiones ocupadas en una ruta pública.
- **Identificadores generados por el cliente como llave natural** _(inferida del plan)_: no protege las acciones que no tienen un identificador natural y deja la repetición al cliente.

## Consecuencias

- **Positivas**: una petición repetida o concurrente no crea dos recursos; una petición caída no bloquea la clave más de un minuto.
- **Negativas o costos**: las filas vencidas no se purgan todavía (falta un trabajo de limpieza); el reintento dentro de las 24 horas no vuelve a comprobar permisos; el cliente debe enviar una clave distinta por cada intención distinta.
- **Verificación**: pruebas de integración de la toma atómica, de la propiedad de la clave y de la no liberación tras un fallo al guardar; la revisión de dos jueces ciegos halló y corrigió cuatro problemas en este diseño.
