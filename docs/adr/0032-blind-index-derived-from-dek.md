# ADR 0032: Índice ciego derivado de la clave de datos

- **Estado**: Aceptada (2026-10-27)
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) (rotación de la clave de datos); `apps/api/src/modules/crypto/application/secret-cipher.ts` (`blindIndex`); [`docs/runbooks/rotate-dek.md`](../runbooks/rotate-dek.md).

## Contexto

El índice ciego (búsqueda y detección de contraseñas repetidas) se deriva de la clave de datos (DEK) con HKDF. Al rotar la DEK cambian todos los valores, así que cada rotación obliga a recalcularlos. Se evaluó si debía usarse una clave estable por organización.

## Decisión

**Se mantiene la derivación desde la DEK.** Ya está implementada y probada. El recálculo ocurre dentro del trabajo de recifrado que ya procesa todos los secretos por lotes, y durante la convivencia de dos versiones de DEK la búsqueda consulta ambas (`dek_version`).

## Alternativas

- **Clave estable por organización** (plan B): evita recalcular, pero añade una tabla de claves en la zona criptográfica protegida y una nueva custodia de clave. Se reconsidera solo si la medición del recifrado muestra que el recálculo es un cuello de botella.

## Consecuencias

- **Positivas**: sin superficie criptográfica nueva; rotar la DEK sigue siendo una sola operación.
- **Negativas**: el recálculo alarga el recifrado; la búsqueda debe cubrir ambas versiones durante la convivencia.
- **Pendiente**: comprobar con prueba que la búsqueda cubre ambas versiones y que el runbook lo menciona.
