# ADR 0046: Alta de la primera organización y su Raíz por un enlace de un solo uso

- **Estado**: Aceptada por **encargo del dueño (2026-11-02)**. Implementación en `odd/tasks/first-root-setup.md`.
- **Fecha**: 2026-11-02
- **Referencias**: [ADR 0021](0021-pre-authentication-access-with-rls.md) (funciones `SECURITY DEFINER` mínimas), [ADR 0037](0037-root-recovery-dual-custody.md) (códigos de emergencia y custodios), [ADR 0038](0038-purge-expired-ephemeral-rows.md) (listado de organizaciones), [`docs/deployment.md`](../deployment.md), tarea de ClickUp 1dfm34y07zm.

## Contexto

Una organización nueva se creaba solo con el comando de operaciones (`main.provision.ts`), que necesita una conexión capaz de saltarse el aislamiento por filas: `organizations` tiene RLS forzado y ninguna política de INSERT, de modo que ni el dueño de la tabla puede insertar sin `BYPASSRLS` o superusuario. En un servidor administrado (staging en Dokploy) no existe ese rol, y crearlo solo para el primer arranque deja una puerta permanente o un paso manual propenso a error.

Hechos verificados en el repositorio: de las tablas que arma el alta (`roles`, `users`, `user_passwords`, `user_roles`, `user_recovery_codes`, `audit_events`) solo `organizations` impide el INSERT a `iam_app`; las demás aceptan la fila con `app.org_id` fijado. Las funciones `auth.*` existentes son de lectura y las posee `iam_auth_reader` (sin `BYPASSRLS`).

## Decisión

La primera organización y su Raíz se crean desde el navegador con un **enlace de un solo uso**, sin rol privilegiado.

1. **Función definer mínima.** La migración 0028 crea `auth.create_first_organization(id, name, slug)`: `SECURITY DEFINER`, dueña `iam_auth_reader`, `search_path` fijo, `EXECUTE` solo para `iam_app`. Da a ese rol `INSERT (id, name, slug)` en `organizations` y una política de INSERT propia. La función **rechaza con SQLSTATE `IAM01` si existe cualquier organización**, bajo un bloqueo consultivo que resuelve las llamadas simultáneas a un solo ganador. Es la mitad "solo funciona si no existe la organización" y vale aunque la aplicación se equivoque.
2. **El resto del alta corre en la misma transacción desde la API**, con el pool de la aplicación y las políticas normales (`app.org_id`): roles del sistema, Raíz, contraseña, códigos de emergencia y evento de auditoría `organization.provisioned`. Ninguna otra tabla gana un privilegio.
3. **Token en el entorno.** `FIRST_SETUP_TOKEN` (32 caracteres o más) lo genera quien despliega y lo carga en Dokploy. Sin la variable, la ruta responde 404. Se compara en tiempo constante sobre digestos SHA-256. Se retira del entorno al terminar; aunque se olvide, el alta ya hecha cierra la ruta.
4. **El enlace** es `<APP_ORIGIN>/setup#token=<valor>`. El token va en el **fragmento**: el navegador no lo envía en la petición de la página, así que no queda en los registros del proxy ni en `Referer`. La página lo lee y lo manda en el cuerpo de `POST /api/v1/setup`. Lo arma quien despliega; no se muestra en ninguna pantalla ni registro.
5. **Quien abre el enlace elige** nombre y identificador de la organización, correo y nombre de la Raíz y su contraseña (política normal, sin cambio forzado). Los códigos de emergencia se muestran **una vez** en la respuesta.
6. **Respuesta uniforme.** Sin configurar, con token equivocado o con el alta ya hecha, la respuesta es la misma `NOT_FOUND`. La ruta es pública, limitada por IP, y **no** usa `@Idempotent()`: guardar la respuesta repetiría los códigos de emergencia.
7. **Auditoría.** El alta exitosa queda en la cadena de auditoría de la organización. Un intento fallido **no puede** auditarse en la base de datos (la auditoría es por organización y todavía no existe ninguna): se deja un aviso operativo con el motivo y la IP, nunca el token, la contraseña ni los códigos.

## Alternativas consideradas

- **Rol con `BYPASSRLS` o superusuario**: descartada; deja un privilegio permanente que el producto no necesita después del primer arranque.
- **Operación única con una conexión de administrador (el comando actual)**: se conserva para otros entornos, pero exige una credencial que Dokploy no ofrece y un paso manual.
- **Política de INSERT abierta en `organizations` para `iam_app`**: descartada; permitiría crear organizaciones desde cualquier camino de la API.
- **Token en la URL (consulta) en vez de fragmento**: descartada; quedaría en registros del proxy.

## Consecuencias

- **Positivas**: el primer acceso no requiere privilegios de base de datos fuera de lo normal; la puerta se cierra sola y la base de datos lo garantiza.
- **Negativas o costos**: una ruta pública más hasta que existe la primera organización (limitada por IP, uniforme y protegida por token); quien tenga el token y llegue antes que el dueño crea la organización, por eso el token es secreto y se retira. Los intentos fallidos solo quedan en el registro de la aplicación.
- **Verificación**: `db/tests/first-organization-setup.test.ts` (privilegios, un solo ganador, cierre tras el primer alta), pruebas del caso de uso y de la configuración, y la prueba del inventario `auth.*` actualizado.

## Notas de uso

- La función de la migración 0028 no sustituye al comando de operaciones: ese sigue siendo el camino para organizaciones posteriores.
