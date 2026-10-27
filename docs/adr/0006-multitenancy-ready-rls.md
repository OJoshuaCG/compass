# ADR 0006: Multitenancy preparada: `organization_id` + RLS en todas las tablas

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Multitenancy preparada desde el día uno"; [`docs/backend.md`](../backend.md) §6.1 y §6.2; [`docs/database.md`](../database.md).

## Contexto

El producto es interno y de una sola organización hoy, pero el retrofit de multitenancy es de los cambios más caros. Pasar a una segunda organización debe ser activar un tenant, no migrar datos.

## Decisión

Aislamiento en tres capas, de modo que si una falla las otras dos contienen el error:

1. **Contexto de petición**: la organización sale de la sesión autenticada; `RequestContext` (AsyncLocalStorage) la transporta.
2. **RLS en PostgreSQL**: toda tabla de dominio tiene `organization_id uuid not null` y una política `organization_id = current_setting('app.org_id')::uuid`. Cada transacción ejecuta `SET LOCAL app.org_id`; sin él, cero filas. La aplicación usa un rol sin `BYPASSRLS` que no es dueño de las tablas.
3. **Claves por organización**: DEK propia y AAD con `org_id` ([ADR 0004](0004-server-side-encryption-kms-per-org-dek.md)).

## Alternativas consideradas

- **Dejar el multitenancy para después**: descartado porque el retrofit es de los más caros (razón del plan).
- **Una base de datos o esquema por organización** _(inferida del plan)_: descartada porque multiplica la operación para un equipo de 3 y el costo de RLS hoy es casi nulo.

## Consecuencias

- **Positivas**: costo casi nulo hoy; defensa en profundidad.
- **Negativas o costos**: todo acceso a datos exige transacción con contexto. El acceso previo a la autenticación (login, invitación, handoff) no conoce `app.org_id`; está abierto en [ADR 0021](0021-pre-authentication-access-with-rls.md).
- **Verificación**: suite de aislamiento con dos organizaciones por repositorio en cada PR; prueba de CI que exige `organization_id`, índice y política RLS en cada tabla nueva.
