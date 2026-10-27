# ADR 0007: 4 actores: Raíz, Administrador, Líder, Operador

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Actores y jerarquía: reglas formales".

## Contexto

Los requisitos de negocio eran contradictorios: "un solo dueño" y "varios del mismo nivel". Había que definir quién crea y gestiona a quién sin dejar actores que crean pares que luego no pueden gestionar.

## Decisión

Cuatro actores con rango numérico (menor rango, más autoridad):

| Actor | Rango | Cuántos | Crea a |
| --- | --- | --- | --- |
| Raíz (dueño) | 0 | Exactamente 1 por organización | Administrador, Líder, Operador |
| Administrador | 1 | Varios | Líder, Operador |
| Líder | 2 | Varios | Operador |
| Operador | 3 | Varios | Nadie |

Solo la Raíz crea Administradores. La matriz de creación se valida en el dominio, no en la UI. Una sola Raíz activa se garantiza con un índice único parcial.

## Alternativas consideradas

- **Permitir que cada actor cree a su mismo rango**: descartado porque el creador no podría gestionar al creado (mismo rango), que es la contradicción que el plan resuelve.
- **Un solo nivel de administración sin Raíz** _(inferida del plan)_: descartado porque contradice el requisito de un dueño único con acceso de emergencia y transferencia.

## Consecuencias

- **Positivas**: jerarquía sin ambigüedad; transferencia y recuperación de la Raíz definidas (reglas 9 y 10).
- **Negativas o costos**: la Raíz es un punto crítico de operación (riesgo "Raíz sin acceso o fuera de la organización"); exige códigos de emergencia custodiados y runbook de transferencia ([transferir Raíz](../runbooks/transfer-root.md)).
- **Verificación**: pruebas de dominio de la matriz de creación y matriz de autorización generada como datos.
