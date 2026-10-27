# ADR 0005: Caché en memoria de DEK descifradas, TTL 10 min

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) secciones "Caché de DEK" y "Cuánto se llama al KMS"; [`docs/backend.md`](../backend.md) §8 (única excepción de estado global).

## Contexto

Sin caché, cada secreto revelado o código generado costaría una llamada al KMS, con latencia y costo crecientes. A la vez, una DEK descifrada es material crítico que no puede salir del proceso.

## Decisión

Caché LRU **en el proceso** con clave `(organización, versión de DEK)` y valor `Buffer`. Cada entrada expira a los 10 minutos o a los 10 000 usos, lo que ocurra primero; al expulsar, el `Buffer` se sobrescribe con ceros (mejor esfuerzo). Peticiones concurrentes por la misma DEK expirada comparten una sola llamada al KMS (single-flight). Nunca en Redis, disco, logs ni volcados de error. Si el KMS no responde, las DEK en caché sirven hasta su TTL y después el descifrado falla cerrado, sin afectar lo que no toca secretos.

## Alternativas consideradas

- **Sin caché**: una llamada al KMS por operación; descartada por costo y latencia (el plan estima unas 18 llamadas por hora con caché).
- **Caché en Redis**: descartada por la regla de nunca guardar material criptográfico fuera del proceso.

## Consecuencias

- **Positivas**: llamadas al KMS en el orden de decenas por hora; disponibilidad parcial ante caídas del KMS.
- **Negativas o costos**: Node no garantiza el borrado de memoria, por eso el TTL es corto; es la única pieza con estado global mutable permitida y vive en `crypto`.
- **Verificación**: pruebas de TTL, límite de usos y single-flight; métrica de aciertos de la caché de DEK y alerta si no hay aciertos.
