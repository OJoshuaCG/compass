# ADR 0008: Autoridad = rango estrictamente inferior + subárbol de gestión

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Regla de gestión" y reglas numeradas de jerarquía.

## Contexto

Había dos intuiciones de autoridad: por nivel (un Administrador gestiona a cualquier Líder) y por linaje (solo gestiona a quien está bajo él). Ninguna basta sola.

## Decisión

```
puedeGestionar(A, T) =
     A.activo ∧ A.organizacion = T.organizacion ∧ A ≠ T
  ∧ ( A.rango = RAIZ ∨ ( A.rango < T.rango ∧ T ∈ subarbol(A) ) )

subarbol(A) = usuarios cuya cadena managed_by llega a A
```

La Raíz gestiona a todos. Es una política pura en `domain`, probada con tablas.

## Alternativas consideradas

- **Solo nivel**: un Administrador gestionaría personas ajenas a su linaje (en el ejemplo del plan, Pedro gestionaría a Luis, creado por Ana). Descartada.
- **Solo linaje** _(inferida del plan)_: descartada porque no impone la relación de rango (`A.rango < T.rango`) que evita la autogestión entre pares y mantiene la jerarquía de 4 niveles.

## Consecuencias

- **Positivas**: regla única, determinista y verificable; sin autogestión.
- **Negativas o costos**: el cálculo del subárbol recorre la cadena `managed_by` y debe ser eficiente en SQL; las bajas deben reasignar subordinados (regla 7) para no dejar subárboles huérfanos.
- **Verificación**: matriz de autorización exhaustiva (actor × rango × relación × acción) y mutación con Stryker en `access`.
