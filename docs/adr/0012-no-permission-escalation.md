# ADR 0012: Nadie otorga un permiso que no tiene

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) secciones "Roles", "Niveles de compartición" y regla de "Cambio de rango".

## Contexto

Si se puede delegar más de lo que se posee, un actor con pocos permisos puede escalar privilegios creando roles o compartiendo niveles superiores al propio.

## Decisión

Principio de no escalamiento aplicado a todos los mecanismos de delegación:

- **Roles personalizados**: sus permisos deben ser un subconjunto de los de su creador.
- **Asignar un rol a T**: el actor debe gestionar a T, tener todos los permisos del rol, y ningún permiso del rol puede superar el techo del rango de T.
- **Compartición**: nadie comparte un nivel superior al suyo sobre ese recurso; un grupo se comparte solo con MANAGE sobre la cuenta.
- **Permisos efectivos**: unión de los roles del usuario recortada por el techo de su rango, recalculada al cambiar el rango.

## Alternativas consideradas

- **Confiar en la UI para ocultar opciones**: descartada; las reglas se validan en el dominio, no en la UI.
- **Permitir delegación sin límite a rangos altos** _(inferida del plan)_: descartada porque contradice el techo de rango por permiso.

## Consecuencias

- **Positivas**: el escalamiento de privilegios por delegación queda cerrado por construcción.
- **Negativas o costos**: un actor sin un permiso no puede delegarlo aunque la operación lo requiera; hay que pedir el permiso a quien lo tenga.
- **Verificación**: casos de la matriz de autorización para asignación de roles, creación de roles y compartición.
