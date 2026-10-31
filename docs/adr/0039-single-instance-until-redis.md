# ADR 0039: Instancia única de la API, con Redis solo cuando haga falta escalar

- **Estado**: Aceptada (2026-10-28). La decisión es del dueño (`TODO.md` F3): declaró que la plataforma corre en una sola instancia, sin copias, y que incorporar Redis no le supone ningún problema si se considera necesario
- **Fecha**: 2026-10-28
- **Referencias**: [ADR 0026](0026-atomic-failed-attempt-counting.md); [ADR 0005](0005-in-memory-dek-cache.md); [`docs/backend.md`](../backend.md) §10 y §16; [runbook](../runbooks/single-instance-operation.md); [`docs/threat-model.md`](../threat-model.md) §4.1.

## Contexto

Los contadores de intentos fallidos (por correo en el ingreso y por usuario en el segundo factor), el límite de 60 peticiones por minuto por IP y la caché de claves de datos (ADR 0005) viven en la memoria de cada instancia de la API. Con N instancias, quien ataca obtiene en la práctica N veces los intentos antes del bloqueo, y un reinicio borra los bloqueos. El plan prevé Redis para los límites, pero no está construido, y la puerta de producción exigía resolver esto antes de abrirla.

## Decisión

La plataforma se despliega y se soporta con **una sola instancia de la API**. No se incorpora Redis ahora.

- La restricción se declara y se hace cumplir: el runbook de instancia única deja de ser un borrador de limitación y pasa a ser la configuración de despliegue vigente, y J1 añade un guardarraíl de arranque que impide que dos instancias convivan.
- Escalar horizontalmente, poner un balanceador con réplicas o activar el autoescalado exige antes **una decisión nueva** que incorpore Redis (contadores y límite por IP compartidos). El dueño ya dejó dicho que usar Redis es aceptable cuando se considere necesario, por lo que esta decisión no lo descarta: lo difiere.
- Mientras tanto, la limitación conocida se mantiene documentada: un reinicio borra los contadores de bloqueo.

## Alternativas consideradas

- **Incorporar Redis ahora**: descartada por ahora. Añade una dependencia y un componente de infraestructura que operar y proteger, para resolver un problema que no existe con una sola instancia. Es la salida prevista si hay que escalar.
- **Contadores en PostgreSQL**: descartada. Cada intento fallido sería una escritura transaccional en la ruta de ingreso, y el límite por IP convertiría a la base de datos en el blanco de un ataque de volumen.
- **No declarar nada**: descartada. Un límite que solo funciona con una instancia, sin que nada lo haga cumplir, se rompe en silencio el día que alguien active el autoescalado.

## Consecuencias

- La disponibilidad queda ligada a una sola instancia: su caída es una caída del servicio. La disponibilidad requerida sigue siendo una decisión pendiente del equipo (C2).
- Las actualizaciones deben detener la instancia vieja antes de arrancar la nueva.
- F4 (rotación de DEK y cachés entre instancias) se simplifica: no hay otras instancias cuyas cachés invalidar mientras esta decisión siga vigente.
- Se revisa esta decisión antes de cualquier despliegue con más de una réplica.

## Notas de uso

- El guardarraíl de arranque (J1) es lo que vuelve esta decisión ejecutable; sin él, solo es una convención.
