# ADR 0025: Aislamiento del tiempo de las sesiones: una sola fuente de reloj

- **Estado**: Aceptada
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) sección "Sesiones"; [`docs/backend.md`](../backend.md) §3.4 (reloj como puerto); [ADR 0014](0014-server-sessions-with-cookie.md).

## Contexto

Una sesión caduca por inactividad a los 30 minutos y de forma absoluta a las 12 horas. Durante la implementación de la fase 1a apareció una inconsistencia: la caducidad se comparaba contra relojes distintos, el de la base de datos (que fijaba la fecha de última actividad) y el de la aplicación (que decidía si la sesión caducó). Dos relojes distintos (aunque estén sincronizados, difieren en milisegundos o segundos) producen resultados que dependen de quién escribió el dato: una sesión podía parecer más reciente o más antigua de lo que era, y las pruebas de caducidad no podían controlar el tiempo porque parte de él venía de la base de datos.

## Decisión

La aplicación fija la última actividad de una sesión con su propio reloj, el mismo puerto de reloj que usa para decidir si la sesión caducó. Los instantes que intervienen en la caducidad y en la reautenticación (última actividad, vencimiento absoluto, verificación del segundo factor, reautenticación y revocación) los calcula la aplicación y la base de datos solo los almacena. Para evitar una escritura por petición, la última actividad solo se actualiza si pasó al menos un minuto desde la anterior.

## Alternativas consideradas

- **Usar siempre el reloj de la base de datos** _(inferida del plan)_: obligaría a que la decisión de caducidad también se calcule en SQL y no se podría controlar el tiempo en las pruebas de dominio ni en las de punta a punta.
- **Mantener ambos relojes y aceptar la diferencia** _(inferida del plan)_: la diferencia sería pequeña, pero el comportamiento dependería de qué camino escribió el dato y sería difícil de reproducir.

## Consecuencias

- **Positivas**: una sola fuente de tiempo para escribir y para decidir; la caducidad es determinista y comprobable con un reloj controlado.
- **Negativas o costos**: con varias instancias de la aplicación, los relojes de las instancias deben estar sincronizados (NTP); la precisión de la caducidad por inactividad es de aproximadamente un minuto por la regla de actualización espaciada.
- **Verificación**: la prueba de punta a punta de la fase 1a comprueba que una sesión caduca tras 30 minutos de inactividad y que no caduca mientras la persona sigue trabajando.
