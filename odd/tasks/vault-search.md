# B6: búsqueda de cuentas, indicador de antigüedad de la contraseña y vistas guardadas

Estado: **parcial** (revisado 2026-11-03): T1, T2 y T3 hechas; T4 (índice ciego) y T5 (vistas guardadas) pendientes. Ruta protegida (bóveda, índice ciego, migración con aislamiento por filas): el dueño asignó el trabajo ("lleva a cabo todo lo necesario y puedes continuar tarea tras tarea pendiente relacionada a ella"). Requiere jueces ciegos y prueba de mutación. Rama: `main` (sin ramas nuevas). Pruebas: solo por `test-runner`.

## Especificación

Pedido original de B6 (`odd/tasks/phase-1b-vault.md`, S8): "Búsqueda por nombre visible, handle, plataforma, etiquetas y grupo, siempre filtrada por acceso efectivo en SQL; búsqueda exacta del usuario de la plataforma por índice ciego; vistas guardadas ("Mis cuentas", "Sin 2FA", "Por rotar")".

Decisión del dueño sobre «Por rotar» (2026-11-02), textual: "No es necesario notificar una rotacion, es invasivo, lo que podriamos tener es una columna de cuando fue su ultimo cambio, e irlo coloreando, o un indicador, solo un circulo de color, indicando si requiere cambio o no, por ejemplo, tipo semaforo, rojo que sigue vigente, amarillo que ya paso mas de 60 dias, y rojo si paso mas de 90 dias. Pero forzarlo o indicarle que la cambie, no lo veo viable".

Reglas:

1. Toda búsqueda y todo filtro se resuelven en SQL sobre `effective_access`; nunca se cargan cuentas ajenas para descartarlas.
2. La lista de cuentas muestra una columna «Último cambio» con la fecha relativa y un círculo de color. Es **solo informativa**: no hay correos, avisos, banners ni bloqueos que obliguen a cambiar la contraseña.
3. Semáforo (supuesto: «rojo que sigue vigente» era **verde**): verde hasta 60 días; amarillo de más de 60 hasta 90 días; rojo de más de 90 días. Los umbrales son constantes de la API, no configuración, y la API entrega el estado ya calculado para que la web no duplique la regla.
4. Una cuenta con varias credenciales toma el estado de la **más antigua** (supuesto). Sin credenciales, el círculo es neutro. La fecha de una credencial es `last_rotated_at` y, si nunca se rotó, la de su creación (supuesto).
5. El color nunca es la única señal: el círculo lleva texto accesible y el texto visible es la fecha relativa; la fecha exacta va en la ayuda contextual.
6. Búsqueda exacta por usuario de la plataforma con el índice ciego (`credential_secrets.blind_index`); el sistema no guarda ni registra el usuario en claro.
7. Vistas guardadas por persona (propias, no compartidas), con la migración 0028 (sin aplicar: las migraciones se aplican en otra fase).
8. El inventario (`vault.inventory.read`) solo admite búsqueda de texto: no lee credenciales, así que su estado de antigüedad es `unknown` y `lastChangedAt` es `null`. Pedir un filtro rápido ahí responde 422 en lugar de ignorarse. Decisión por seguridad tras los dos jueces: el inventario es «solo metadatos» y quien lo lee no accede a las cuentas.

## Decisiones de diseño (UX)

- Búsqueda en un solo campo arriba de la tabla, con espera corta al teclear y el texto en la URL; filtros rápidos como fichas («Todas», «Por revisar» = amarillo y rojo, «Sin 2FA»); «Guardar vista» como acción secundaria.
- El indicador va en la tabla estándar, sin ventanas emergentes ni avisos nuevos.

## Tareas

- [x] T1. Búsqueda de texto en SQL con acceso efectivo (API, contratos, repositorio, pruebas). Evidencia: `vault-account-search.e2e.test.ts` 14/14; mutación del escape de `_` y mutación de la unión de acceso (SQL válido) detectadas.
- [x] T2. Estado de antigüedad por cuenta (API) y filtros «Por revisar» y «Sin 2FA». Evidencia: `password-age.test.ts` y las pruebas de la API; paginación con cursor y filtro (12 cuentas, 2 páginas).
- [x] T3. Web: campo de búsqueda, fichas de filtro y columna «Último cambio» con círculo (es-MX y en-US, accesibilidad). Evidencia: `accounts.test.tsx` y `use-table-query.test.tsx` en verde (iteración 1: 58/58 con directory; iteración 2 pendiente de cierre); typecheck y lint web en verde. Decisión: búsqueda y filtro viven en memoria (la pantalla ya guarda la pestaña en memoria y su ruta no tiene parámetros de búsqueda), no en la URL.
- [ ] T4. Búsqueda exacta por usuario con índice ciego (ruta protegida; prueba de plan de ejecución).
- [ ] T5. Vistas guardadas (migración nueva, API y web). La 0028 ya la usa `0028_first_organization_setup.sql`; al 2026-11-03 la siguiente libre es la 0033.
- [ ] T6. Jueces ciegos, mutación deliberada, documentación.

## Bitácora

- L1 (2026-11-02): "ADelante, lleva a cabo todo lo necesario y puedes continuar tarea tras tarea pendiente relacionada a ella".
- L2 (2026-11-02): decisión del dueño sobre el semáforo (texto en la especificación). Pidió pensar mucho la UI/UX y lo más común entre las personas.
- L3 (2026-11-02): jueces ciegos A y B sobre T1+T2. Ambos confirmaron: el inventario exponía antigüedad y 2FA de cuentas sin acceso (corregido, regla 8); y pruebas de autorización débiles (se añadieron cuenta compartida frente a privada, compartición revocada, cursor con filtros, 403 sin permiso de inventario). Corregido también el doble `clock.now()` (un solo instante). Pendiente de decisión de negocio: el filtro «Sin 2FA» no distingue el tipo de credencial (`password`, `password_totp`, `totp_only`) y el mínimo de antigüedad incluye `totp_only`. Las pruebas de autorización de este bloque necesitan revisión humana.
- L4 (2026-11-02): mutaciones deliberadas. A (sin escapar `_`): falla «treats % and _ literally». B (quitar parámetro del usuario): rompió el SQL con 500, no sirve como evidencia. B2 (`ea.user_id = $1 or true`): fallan 4 pruebas de aislamiento con fuga real de cuentas ajenas. Original restaurado y verificado idéntico.
