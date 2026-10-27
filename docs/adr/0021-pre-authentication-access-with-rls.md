# ADR 0021: Acceso previo a la autenticación con RLS

- **Estado**: Aceptada (implementada en la fase 1a)
- **Fecha**: 2026-10-26 (propuesta); 2026-10-27 (aceptada)
- **Referencias**: [`plan.md`](../../plan.md) sección "Capa 2: Row-Level Security en PostgreSQL" y "Autenticación del propio sistema"; [`docs/backend.md`](../backend.md) §16; [`docs/database.md`](../database.md); [ADR 0006](0006-multitenancy-ready-rls.md).
- **Implementación**: se adoptó la opción 1. La migración `db/migrations/0008_auth_functions.sql` crea en un esquema propio cuatro funciones de lectura mínima (inicio de sesión por correo, sesión por hash del token, invitación por hash del token y entrega de handoff), propiedad de un rol sin inicio de sesión y sin `BYPASSRLS`, con `search_path` fijo y `EXECUTE` concedido solo al rol de la aplicación. El módulo `identity` las consume desde `apps/api/src/modules/identity/infrastructure/pg-pre-auth-lookup.ts`, sin abrir una transacción con `app.org_id` porque la organización aún no se conoce; tras resolverlas, el resto del caso de uso corre con el contexto normal. Las tres primeras ya se usan en la fase 1a; la de handoff existe pero aún no tiene consumidor (llega con el registro de 2FA por celular, fase 1b).

## Contexto

El plan exige que cada transacción ejecute `SET LOCAL app.org_id` y que, sin esa variable, las consultas devuelvan cero filas (falla cerrada). Pero varias operaciones ocurren **antes** de conocer la organización del actor:

- **Login**: buscar al usuario por correo (único globalmente en v1) para verificar su contraseña.
- **Invitación**: resolver el token de invitación (`invitations.token_hash`).
- **Handoff de 2FA**: resolver el token del handoff desde el celular, que no tiene sesión.
- **Sesión**: buscar la sesión por `sessions.token_hash` para saber quién es el actor y a qué organización pertenece.

Con RLS y falla cerrada estas consultas devolverían cero filas. Hace falta un camino definido que no debilite el aislamiento.

## Opciones

1. **Funciones `SECURITY DEFINER` mínimas** (recomendada). Un conjunto pequeño y revisado de funciones SQL, propiedad del rol de migraciones, con `search_path` fijo, que reciben el token ya hasheado o el correo y devuelven solo lo estrictamente necesario (por ejemplo, `user_id` y `organization_id`, o el registro de sesión). El rol de la aplicación tiene `EXECUTE` sobre ellas y sigue sin `BYPASSRLS` ni acceso directo a las tablas fuera de RLS. Tras resolverlas, la aplicación abre la transacción normal con `SET LOCAL app.org_id`.
2. **Un segundo rol de base de datos para el pre-auth** con políticas RLS específicas (por ejemplo, lectura por `token_hash` igual al valor de una variable de sesión). Aísla por rol, pero añade otro rol, otra cadena de conexión y políticas por tabla difíciles de auditar _(inferida del plan)_.
3. **Políticas RLS permisivas por columna** (permitir `SELECT` cuando se conoce `token_hash` o `email`). Mantiene un solo rol pero debilita la política uniforme `organization_id = current_setting(...)` que el plan quiere verificable por una prueba de CI _(inferida del plan)_.
4. **Dar `BYPASSRLS` al rol de la aplicación solo en esas rutas**: contradice el plan (el rol de la aplicación no tiene `BYPASSRLS`). Descartada.

## Recomendación

Opción 1: funciones `SECURITY DEFINER` mínimas, enumeradas en `db/migrations`, cada una con prueba que verifica que (a) devuelve solo las columnas previstas, (b) no acepta parámetros que permitan enumerar (sin búsquedas parciales ni listados), (c) usa `search_path` fijo y (d) un rol sin permiso no puede alterarlas. Son rutas protegidas (migraciones con RLS) y requieren dos revisores. Los mensajes y tiempos de respuesta de login deben seguir siendo idénticos para usuario inexistente o contraseña incorrecta.

Esta recomendación pasó a ser la decisión al aceptarse el ADR; el texto original se conserva como contexto de la elección.

## Consecuencias (si se acepta la recomendación)

- **Positivas**: superficie de excepción pequeña, nombrada y probada; el aislamiento general no se debilita.
- **Negativas o costos**: código SQL privilegiado que debe revisarse con el mismo rigor que la criptografía; cada nueva ruta pre-auth requiere otra función y revisión.
- **Pendiente**: lista exacta de funciones y sus firmas (a definir en [`docs/database.md`](../database.md) cuando el diseño las incorpore).
