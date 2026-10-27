# ADR 0008: Autoridad = rango estrictamente inferior + subárbol de gestión

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Regla de gestión" y reglas numeradas de jerarquía.

## Contexto

Había dos intuiciones de autoridad: por nivel (un Administrador gestiona a cualquier Líder) y por linaje (solo gestiona a quien está bajo él). Ninguna basta sola.

## Decisión

Un actor A puede gestionar a un objetivo T solo si se cumplen todas estas condiciones:

1. A está activo.
2. A y T pertenecen a la misma organización.
3. A y T son personas distintas.
4. A es la Raíz, o bien A tiene un rango estrictamente inferior (más autoridad) que T y T está dentro del subárbol de A.

El subárbol de A son las personas cuya cadena de responsables llega hasta A. La Raíz gestiona a todos. Es una política pura en la capa de dominio, probada con tablas. La explicación en lenguaje de negocio está en [`docs/business/actors-and-hierarchy.md`](../business/actors-and-hierarchy.md).

## Alternativas consideradas

- **Solo nivel**: un Administrador gestionaría personas ajenas a su linaje (en el ejemplo del plan, Pedro gestionaría a Luis, creado por Ana). Descartada.
- **Solo linaje** _(inferida del plan)_: descartada porque no impone la relación de rango (`A.rango < T.rango`) que evita la autogestión entre pares y mantiene la jerarquía de 4 niveles.

## Consecuencias

- **Positivas**: regla única, determinista y verificable; sin autogestión.
- **Negativas o costos**: el cálculo del subárbol recorre la cadena `managed_by` y debe ser eficiente en SQL; las bajas deben reasignar subordinados (regla 7) para no dejar subárboles huérfanos.
- **Verificación**: matriz de autorización exhaustiva (actor × rango × relación × acción) y mutación con Stryker en `access`.
