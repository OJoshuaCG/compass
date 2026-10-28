# ADR 0036: Acceso efectivo calculado al vuelo

- **Estado**: Aceptada (2026-10-27)
- **Fecha**: 2026-10-27
- **Referencias**: `db/migrations/0007_*` (vista `effective_access`); `docs/database.md`; tarea I1.

## Contexto

La vista `effective_access` (`security_invoker`) calcula el nivel máximo de acceso en cada consulta, ignorando comparticiones revocadas o vencidas con `now()` y excluyendo grupos archivados. Aún no incluye la jerarquía. Se evaluó materializarla.

## Decisión

1. **Se mantiene la vista calculada al vuelo.** Una vista materializada obligaría a invalidarla por cada cambio y por el paso del tiempo (vencimientos), con riesgo de conceder acceso obsoleto.
2. La **jerarquía** se añade como filtro SQL adicional, no como tabla derivada.
3. **Se mide antes de materializar**: el criterio de rendimiento se incorpora a la tarea I1.

## Alternativas

- **Vista materializada o tabla derivada**: _(inferida)_ más rápida en lectura, pero con riesgo de obsolescencia en un sistema donde un acceso vencido debe negarse al instante.

## Consecuencias

- **Positivas**: siempre correcta respecto al tiempo y a las revocaciones.
- **Negativas**: el costo crece con el número de comparticiones y grupos.
- **Pendiente**: medir con volumen realista en I1; cambiar solo si se supera el umbral que defina esa tarea.
