# ADR 0038: Los trabajos de fondo recorren las organizaciones con una función `auth` y purgan bajo RLS

- **Estado**: Aceptada con confirmación pendiente (Ingeniería)
- **Fecha**: 2026-10-28
- **Referencias**: [`docs/database.md`](../database.md) §7 y §7.5; [ADR 0035](0035-transactional-outbox-for-events.md) (punto 5: retención de eventos publicados); tareas G1 y H1 de [`TODO.md`](../../TODO.md).

## Contexto

- `idempotency_keys` y `webauthn_challenges` son datos efímeros con fecha de vencimiento. Nada los borra: las filas vencidas se acumulan desde la fase 1a (`docs/database.md` §7.5).
- Ambas tablas tienen aislamiento por fila forzado: sin `app.org_id` el rol de la aplicación (`iam_app`) no ve ni borra nada. Un trabajo que corre fuera de una petición no conoce ninguna organización y, por diseño, no hay forma de listarlas: las cuatro funciones `auth.*` buscan por una clave exacta y "ninguna función recibe un `organization_id`" (§7.3).
- `iam_app` puede borrar `idempotency_keys` (la tabla lo concede desde la `0003`), pero **no** `webauthn_challenges` (la `0011` solo concede `SELECT`, `INSERT` y `UPDATE`).
- Borrar una fila vencida no cambia el comportamiento: la aplicación ya trata una clave de idempotencia vencida como libre (la reclama con `takeOver`) y un desafío vencido como inexistente (`consume` exige `expires_at > now`).
- No hay proceso de fondo (la tarea H1 lo crea y la decide el equipo). Otros trabajos futuros también tendrán que recorrer organizaciones: verificación diaria de la cadena de auditoría, vencimiento de comparticiones, publicación del outbox y rotación de DEK.

## Decisión

1. **Recorrido de organizaciones.** Una función `auth.list_organization_ids()` con el mismo molde de las funciones `auth.*`: `SECURITY DEFINER`, dueña `iam_auth_reader` (sin `BYPASSRLS`), `search_path = pg_catalog`, `STABLE`, `EXECUTE` revocado a `PUBLIC` y concedido solo a `iam_app`. Devuelve **solo** el `id` de cada organización (permiso por columna sobre `organizations.id` y una política `to iam_auth_reader using (true)`), sin parámetros. Es la primera función `auth` que no es de acceso previo a la autenticación: existe para los trabajos de fondo.
2. **Todo lo demás bajo RLS normal.** El trabajo fija `app.org_id` de una organización a la vez (con el `TenantScope` de siempre y `actorId` nulo, como proceso del sistema) y borra dentro de esa transacción. Ninguna función privilegiada borra filas.
3. **Qué se purga y cuándo.** Una fila se borra solo si venció hace más de **1 hora** (margen de gracia frente a peticiones en curso y desfases de reloj):
   - `idempotency_keys`: `expires_at` anterior al corte.
   - `webauthn_challenges`: `expires_at` anterior al corte (usadas o no). La migración concede `DELETE` a `iam_app` sobre esta tabla y añade el índice `(organization_id, expires_at)`.
4. **Lotes cortos.** Se borra por lotes de 1000 filas, cada uno en su propia transacción, para no retener bloqueos.
5. **Sin auditoría.** Purgar datos efímeros vencidos no es una acción de negocio ni toca datos de personas: no se escribe en `audit_events` (que además serializa por organización). El comando informa por su salida cuántas filas borró por tabla.
6. **Dónde corre, mientras no exista H1.** Un comando de operaciones, `main.purge.ts` (script `purge`), con la credencial de `iam_app`, que se programa por fuera (cron o el planificador de la plataforma; propuesta: cada hora). El caso de uso vive en el módulo `maintenance` y no depende del comando: cuando H1 cree el proceso de fondo, lo llamará igual.
7. **Retención del outbox (punto 5 del ADR 0035).** Los eventos **publicados** se purgan cuando `published_at` tiene más de 7 días; los pendientes nunca. Se implementará junto con el escritor y el publicador del outbox, que hoy no existen; este ADR solo fija la regla.

## Alternativas consideradas

- **Función privilegiada que borre en todas las organizaciones de una sola vez** (`SECURITY DEFINER` con `DELETE` y política propia): no expone la lista de organizaciones, pero da poder de borrado entre organizaciones a un rol y no sirve a los demás trabajos que sí necesitan recorrerlas. Descartada.
- **Rol de base de datos propio para los trabajos de fondo** (`iam_worker`, con credencial aparte): mínimo privilegio más estricto, pero exige otro rol en `bootstrapRoles`, otra credencial en cada despliegue y su runbook. Hoy no reduce el riesgo de forma apreciable: `iam_app` ya fija `app.org_id` a voluntad, así que quien la comprometa ya alcanza cualquier organización; conocer sus `id` no le da nada nuevo. Se reconsidera si llega una segunda organización o si H1 separa el trabajador en otro despliegue. _(inferida del plan)_
- **Purga oportunista dentro de las peticiones** (al emitir un desafío, borrar los vencidos de esa organización): no requiere recorrer organizaciones, pero alarga peticiones de identidad, deja filas en organizaciones inactivas y no resuelve los demás trabajos de fondo. Descartada.
- **`BYPASSRLS` para el trabajo**: exige superusuario para crear el rol y lee todo. Descartada por la misma razón que en §7.3.

## Consecuencias

- **Positivas**: las tablas efímeras dejan de crecer; queda la pieza que necesitan los demás trabajos de fondo; el borrado sigue sujeto a RLS y a los permisos de `iam_app`.
- **Negativas o costos**: `iam_app` puede listar los `id` de todas las organizaciones, lo que relaja el principio "no hay forma de enumerar organizaciones" de §7.3 (los datos siguen protegidos por RLS). Mientras no exista H1, alguien debe programar el comando; si nadie lo hace, las filas vuelven a acumularse (sin riesgo de seguridad, solo de espacio).
- **Verificación**: la prueba de `auth.*` exige el molde (`SECURITY DEFINER`, `search_path`, dueño sin `BYPASSRLS`, solo `iam_app`) también para la función nueva; `db/tests/background-jobs.test.ts` comprueba que devuelve solo `id`, que `iam_auth_reader` no lee otra columna de `organizations`, que la política de listado es solo suya y que `iam_app` borra desafíos vencidos solo de la organización fijada; `apps/api/test/purge.integration.test.ts` ejecuta el caso de uso con el SQL real contra la base (corte de 1 hora en dos organizaciones, segunda corrida en cero); las pruebas unitarias cubren los lotes y la propagación de errores.
- **Concurrencia**: el `DELETE` repite el corte fuera de la subconsulta, para que una fila renovada mientras esperaba su bloqueo (por ejemplo, una clave de idempotencia reclamada con `takeOver`) no se borre. Y si la purga borra una clave entre el `find` y el `takeOver` de una petición que la reutiliza, el servicio de idempotencia vuelve a intentar la reserva en lugar de responder "en curso".
