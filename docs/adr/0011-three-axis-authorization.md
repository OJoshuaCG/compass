# ADR 0011: Autorización en tres ejes: jerarquía, permisos (RBAC), alcance (ACL)

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Modelo de autorización" (catálogo de permisos, niveles de compartición, motor de decisión); [`docs/backend.md`](../backend.md) §5.2.

## Contexto

Tres preguntas distintas deben responderse en cada acción: a quién puedes gestionar, qué acciones puedes hacer y sobre qué recursos. Mezclarlas en un solo mecanismo haría que crecieran juntas y que un cambio en una rompiera las otras.

## Decisión

Toda decisión evalúa tres ejes y se niega por defecto:

- **Jerarquía**: a quién gestionas (`puedeGestionar`, [ADR 0008](0008-authority-rank-and-subtree.md)).
- **Permisos (RBAC)**: qué acciones puedes hacer; el catálogo vive en código (`enum` versionado), con un techo de rango por permiso.
- **Alcance (ACL)**: sobre qué recursos, mediante comparticiones con niveles USE, VIEW, EDIT y MANAGE.

Una acción sobre un secreto exige el permiso **y** el nivel de compartición; ninguno basta solo. Un único motor, `Authorizer.authorize()`, evalúa los 7 pasos (tenant, sesión, permiso, jerarquía, compartición, restricciones de contexto, obligaciones). El guard del controlador verifica solo el permiso y es una red de seguridad. Los listados filtran en SQL mediante la vista `effective_access`.

## Alternativas consideradas

- **Solo RBAC** _(inferida del plan)_: descartado porque no expresa "sobre qué cuenta" ni "a quién gestionas".
- **Solo ACL por recurso** _(inferida del plan)_: descartado porque no limita qué acciones puede ejecutar un rango (techos de permiso).
- **Permisos en base de datos**: el plan los mantiene en código para versionarlos y revisarlos como código.

## Consecuencias

- **Positivas**: cada eje crece por separado; decisión auditable con código de motivo estable.
- **Negativas o costos**: tres evaluaciones por acción; la matriz de pruebas es grande (se genera como datos).
- **Verificación**: matriz de autorización al 100 % de combinaciones definidas, mutación con Stryker en `access`, pruebas de listados filtrados en SQL.
