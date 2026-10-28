# ADR 0034: Generador de TOTP en el proceso de la API

- **Estado**: Aceptada (2026-10-27). El aislamiento previo a producción es la tarea N4
- **Fecha**: 2026-10-27
- **Referencias**: [ADR 0013](0013-server-side-totp-generation.md); [ADR 0019](0019-cerby-style-broker-ports-first.md); [`plan.md`](../../plan.md).

## Contexto

El ADR 0013 fija que el servidor genera los códigos TOTP, por lo que el proceso que los genera custodia semillas descifradas durante un instante. Hay que decidir dónde corre.

## Decisión

1. En la fase 1b el generador corre **en el mismo proceso de la API**, con límite de tasa y alerta de deriva de reloj.
2. Se diseña **detrás de un puerto**, de modo que pueda moverse a un proceso aislado sin cambiar los casos de uso.
3. Antes de la puerta de producción se aísla: tarea **N4** (depende de N1 y B9). No es una intención, es un requisito de cierre.

## Alternativas

- **Servicio aparte desde el inicio**: _(inferida)_ mejor aislamiento, pero añade operación y despliegue antes de tener la bóveda.

## Consecuencias

- **Positivas**: avance rápido en 1b sin cerrar la puerta al aislamiento.
- **Negativas**: mientras no se ejecute N4, un compromiso del proceso de la API expone semillas en memoria.
- **Pendiente**: N4; no cargar credenciales reales antes de cerrarla.
