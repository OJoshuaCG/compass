# ADR 0038: Purga de filas efímeras vencidas y recorrido de organizaciones

- **Estado**: Aceptada (2026-10-27)
- **Fecha**: 2026-10-27
- **Referencias**: `db/migrations/0014_*`, `db/migrations/0005_vault.sql` (política de borrado de versiones no vigentes); `docs/database.md` §7.5; [ADR 0035](0035-transactional-outbox-events.md) (retención del outbox, ampliación D6); tarea G1.

## Contexto

`idempotency_keys` y `webauthn_challenges` solo sirven hasta su vencimiento, pero nada las borraba: crecían sin límite. Un trabajo de fondo no tiene petición ni organización, y `iam_app` solo ve su propia organización (`organizations_self_read`), así que no puede recorrerlas.

## Decisión

1. **`auth.list_organization_ids()`**: función `SECURITY DEFINER` con el molde de `0008` (dueño `iam_auth_reader`, `search_path` fijo, `EXECUTE` solo para `iam_app`, `SELECT` de la sola columna `id` y una política dedicada). Devuelve solo identificadores, sin filtrar por estado: una organización suspendida también acumula filas vencidas.
2. **El borrado corre bajo el aislamiento normal**: el trabajo fija `app.org_id` por organización (`TenantScope.runAs`, actor nulo) y borra con `iam_app`. Ninguna política se relaja; se concede `DELETE` sobre `webauthn_challenges` (ya lo tenía `idempotency_keys`).
3. **Margen de una hora** tras el vencimiento (`EXPIRED_RETENTION_GRACE_MS`): una petición en vuelo aún puede consultar lo que acaba de vencer.
4. **Lotes de 1000 filas, una transacción por lote**, para no sostener bloqueos largos.
5. **Un fallo en una organización no detiene a las demás**: se cuenta y el comando sale con código 1.
6. **Sin evento de auditoría**: son datos de mantenimiento sin significado de negocio, no una acción sensible; auditar cada purga llenaría la cadena de ruido. El resultado se imprime como conteos.
7. **Punto de entrada**: `pnpm --filter @iam/api purge-expired` (`main.purge-expired.js`), pensado para el cron del anfitrión con `DATABASE_URL` del rol de la aplicación.

## Ampliación (2026-10-29, tarea H1b): versiones de secreto TOTP reemplazadas

El mismo comando destruye las versiones del secreto del segundo factor que un re-registro reemplazó hace más de **30 días** (`docs/business/two-factor.md` DF-10 y `docs/business/vault.md` BO-6; decisión del dueño: se conservan 30 días por si la plataforma no aceptó el cambio).

1. **El esquema sí conserva las versiones reemplazadas**: `credential_totp` guarda solo el registro vigente (`replace()` lo sobrescribe), pero el secreto cifrado vive en `credential_secrets` (`field = 'totp_uri'`), donde cada re-registro inserta una versión nueva y marca la anterior con `is_current = false`.
2. **Sin migración**: el rol de la aplicación ya tiene `DELETE` sobre `credential_secrets` y la política `credential_secrets_purge_old` (0005) solo deja borrar versiones no vigentes. No se concede nada nuevo.
3. **Momento del reemplazo**: la tabla no guarda cuándo se reemplazó una versión. Es el momento de creación de la versión posterior (el re-registro inserta la nueva en la misma transacción que retira la anterior). Se borra una versión no vigente si existe una posterior creada hace 30 días o más. Una versión sin sucesora, o la vigente, nunca se borra.
4. **Alcance**: solo `totp_uri`. No toca contraseñas ni otros campos (la retención general, C9, sigue pendiente de decisión), ni el secreto vigente aunque esté `pending`, `verified` o `retired`. Una versión que quedó `pending` y fue reemplazada de nuevo sí cuenta como reemplazada.
5. **Mismo molde**: por organización con `TenantScope.runAs` (actor nulo), lotes de 1000, una transacción por lote, idempotente; no descifra nada. El conteo sale en la línea de resumen, sin identificadores ni contenido.
6. **Sin auditoría (decisión abierta, opción conservadora)**: se sigue la decisión 6 (mantenimiento del sistema sin actor). Alternativa si el dueño o seguridad lo piden: un evento de auditoría con actor nulo y solo el conteo por organización, en la misma transacción de cada lote.
7. **30 días fijo en código** (`REPLACED_TOTP_SECRET_RETENTION_DAYS`): `vault.md` lo llama "configurable", pero no hay variable ni pantalla definidas. Decisión abierta.
8. **Rendimiento**: no hay índice parcial sobre versiones no vigentes; el borrado recorre las filas de la organización. Aceptable con el volumen actual; un índice sería una migración nueva si hiciera falta.

## Alternativas

- **Rol con `BYPASSRLS` para el trabajo**: descartada; rompe la garantía de que ningún proceso salta el aislamiento.
- **Borrar al vencer, dentro de la petición**: _(inferida)_ añade escrituras al camino caliente y no cubre lo que nadie vuelve a consultar.
- **`pg_cron` en la base**: _(inferida)_ obliga a una extensión y deja la política fuera del código revisado.

## Consecuencias

- **Positivas**: las tablas dejan de crecer; el recorrido de organizaciones queda reutilizable para los demás trabajos de fondo (§7.5).
- **Negativas**: hay que programar el comando; una función más con `SECURITY DEFINER` que revisar (expone solo ids).
- **Riesgo aceptado**: cualquier sesión de `iam_app` (incluida la API que atiende peticiones) puede listar los ids de todas las organizaciones. Son UUIDv7 sin nombre ni datos, y quien ya controla el rol de la aplicación puede, además, fijar `app.org_id` a cualquier valor que conozca; no se amplía el alcance real de un compromiso, solo se facilita enumerar.
- **Pendiente**: programar el cron en el despliegue real (la purga de versiones TOTP depende de él); el cron también ejecuta la retención del outbox (D6, ADR 0035). Ampliación D6 (2026-10-30): `purge-expired` borra además los eventos del outbox publicados hace más de 7 días y sus acuses, por organización y bajo el mismo aislamiento por filas; ver la adenda del ADR 0035.
