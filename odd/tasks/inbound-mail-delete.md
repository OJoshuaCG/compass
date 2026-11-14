# Borrado de correo a petición del buzón real

Ruta protegida (acceso, auditoría, migración con aislamiento, revelación): encargada por el dueño. Rama: `main`. Pruebas: solo por `test-runner`, dirigidas. Ver la enmienda «borrado de correo a petición» del ADR 0045.

## Especificaciones (lo pedido)

- S1 (enmienda ADR 0045, 2026-11-10): «Debe poder borrarse un mensaje del buzón IMAP real, solo cuando una persona lo solicita; nunca de forma automática.»
- S2: «Solo quien dio de alta la fuente (`mail_sources.created_by`) o un Administrador de la organización. Quien recibe la vista compartida no puede borrar.»
- S3: «Implementarlo exige un permiso nuevo, reautenticación, auditoría (también de las negaciones), que la cuenta IMAP tenga permiso de borrar en el servidor y actualizar el modelo de amenazas.»
- S4: no se guarda ningún correo (ni cuerpo ni asunto).
- S5 (dueño, 2026-11-14): «Claro, tendramos que utilizar la opcion 1.» (guardar el UID del mensaje, sin contenido, con la vigencia de su registro).
- S6 (dueño, 2026-11-14): «en caso que no encuentre el codigo, listar o mostrar el contenido completo del correo» → aprobada mi propuesta: asunto visible para confirmar; cuerpo completo solo bajo las condiciones de `inbound.reveal_reset` (reautenticación, motivo escrito, auditoría crítica), como texto plano, sin HTML ni enlaces activos, sin registrarlo ni guardarlo, solo en el estado del componente que lo muestra.
- S7 (dueño, 2026-11-14): «el unico detalle que veo, es que el codigo venga en otro formato y no solo totp tipo 6 digitos, si no mas digitos o con caracteres.» Verificado: las plantillas ya admiten 4 a 12 caracteres, solo dígitos o alfanuméricos. Guiones, espacios, símbolos y más de 12 caracteres no están soportados y van a cuarentena (`EXTRACTION_FAILED`): tarea aparte de plantillas.

## Decisiones mías (conservadoras, por confirmar)

- D1: el UID y el `UIDVALIDITY` se guardan en la fila de `inbound_receipts` (existe para cada mensaje procesado, aceptado o en cuarentena), no en `inbound_items`; así un correo cuya extracción falló también se puede borrar. Se purgan con la fila del historial.
- D2: el borrado exige que el `UIDVALIDITY` guardado coincida con el del buzón; si cambió, el UID no significa nada y se responde que el mensaje ya no se puede localizar (no se borra otro).
- D3: un mensaje sin UID guardado (recibos anteriores a la migración) no se puede borrar desde Compass.

## Tareas

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| D1 | Migración 0037: columnas de UID en `inbound_receipts`, permiso nuevo en `permission_rank_ceiling()` | inline | Hecho, `98d68cc` (pruebas de la migración y techos en verde) |
| D2 | Registrar el UID al procesar cada mensaje (recorder y sondeo) | inline | Hecho, `98d68cc` |
| D3 | Puerto y adaptador IMAP de borrado (bloqueo de escritura) | inline | Hecho (commit al cerrar); 98/98 pruebas del adaptador y el sondeo |
| D4a | Migración 0038: tabla de peticiones de borrado (organización, índice, aislamiento, permisos de columna del worker) | inline | Hecho (commit al cerrar); 29/29 pruebas de BD (nueva + RLS) |
| D4b | API: caso de uso `RequestInboundMailDelete` (permiso, rango o creador, reautenticación, auditoría y negaciones) | inline | Hecho (commit al cerrar); 11 pruebas unitarias en verde, typecheck/lint/format limpios. Falta prueba de integración del adaptador Pg (en D8) |
| D4c | Worker: ejecuta las peticiones pendientes (UIDVALIDITY, `deleteMessage`, resultado) | inline | Hecho (commit al cerrar); 15 pruebas unitarias en verde, typecheck/lint/format limpios. Falta integración del adaptador Pg del worker (en D8) |
| D5 | Controlador, contratos, textos de error | inline | Hecho (commit al cerrar); typecheck/lint/format limpios, contratos y caso de uso en verde. Controlador y cableado sin prueba directa: solo los cubre el e2e (necesita contenedores, en D8) |
| D6 | Vista previa del correo (asunto, y cuerpo bajo `reveal_reset`) | inline | Pendiente |
| D7 | Web: acción de borrar y diálogo | `frontend-developer` | Hecho (commit al cerrar); typecheck/prettier/eslint limpios, pruebas de la función y de catálogo en verde tras 1 ciclo de corrección |
| D8 | Pruebas, modelo de amenazas, ADR 0045, docs | inline | Docs hechos, `3904869`. Pendiente: pruebas de integración de los adaptadores Pg (necesitan Podman o Docker) |
| D9 | Jueces ciegos, mutación deliberada | jueces | Hecho (ver L8) |

## Bitácora

- L1 (2026-11-14): decisión del dueño, texto en S5 a S7.
- L2 (2026-11-14): D3 exige UIDPLUS en el servidor. Sin él, `EXPUNGE` borraría todos los mensajes marcados `\\Deleted` del buzón, no solo el pedido; el adaptador falla cerrado (`MailboxDeleteUnsupportedError`) antes de marcar nada. Consecuencia para operación: la cuenta IMAP debe estar en un servidor con UIDPLUS (verificar en el servidor real).
- L3 (2026-11-14): decisión del dueño: «Opcion A, la verdad, si no hay worker aun, podemos ir por la opcion A. Pero si ya hay worker, vamos con la opcion B». El worker existe (`main.inbound-poll.ts`, rol `iam_inbound_worker`), así que va la B: la API solo registra la petición y el worker la ejecuta; la API nunca descifra la contraseña del buzón. Suposición mía: «ya hay worker» = existe en el código, no que esté desplegado.
- L4 (2026-11-14): D4b. Quien no es Administrador ni creador de la fuente recibe `NOT_FOUND` (no se revela si el recibo existe) y la negación se audita con la fuente. Un recibo sin posición responde `INBOUND.MAIL_NOT_DELETABLE` (código nuevo, 422) sin auditar (no hay cambio de estado). Una petición ya pendiente responde igual sin auditar de nuevo. El SQL `on conflict … where status = 'pending'` del adaptador aún no se ejercita contra una base real: pendiente en D8.
- L5 (2026-11-14): D4c. El worker ejecuta los borrados después del sondeo en `main.inbound-poll.ts`, hasta 20 por fuente y pasada. Fallos de conexión, KMS o contraseña cierran la petición como fallida (`CONNECTION`/`CONNECTION_MISSING`) en vez de reintentar sin límite: el worker no puede leer `requested_at`, así que no hay forma de acotar la edad de un reintento. La persona puede volver a pedirlo. Un defecto (`UNEXPECTED`) corta la sesión, deja lo demás pendiente y hace salir el proceso con código 1. Si dos pasadas coinciden, el cierre solo actúa sobre filas pendientes. Pendiente en D8: prueba de integración de `PgMailDeleteWorkStore` y actualizar el runbook.
- L6 (2026-11-14): D5. Rutas `POST` y `GET /inbound/receipts/:receiptId/mail-delete`. El POST responde 202 con `{ status: 'pending', alreadyPending }` y es idempotente (la respuesta no lleva datos del correo). El GET devuelve `{ data: null }` si nunca se pidió. Los textos de error ya se agregaron en D4b.
- L7 (2026-11-14): D7. Botón por fila con diálogo de confirmación y estado (pendiente, borrado, fallido con código acotado). La reautenticación la resuelve el cliente HTTP; el estado se consulta cada 5 s (máximo 3 min) solo tras confirmar en esta sesión. La interfaz muestra el botón a quien tenga `inbound.delete_mail` con nivel MANAGE en la vista, pero quien decide es el servidor (solo Administrador o creador de la fuente; el resto recibe `NOT_FOUND`). Una petición pendiente de antes de recargar la página no se muestra hasta volver a pedirla (el POST es idempotente). Un test fallaba porque el modal de Radix deja el resto de la página en `aria-hidden`: se corrigió la consulta del test, no el componente.
- L8 (2026-11-14): D9. Dos jueces ciegos sobre el mismo alcance (migraciones 0037/0038, casos de uso, adaptadores, controlador, worker, catálogo de permisos, celda web). Sin bypass de autorización, fuga entre organizaciones ni borrado automático. Único punto confirmado por ambos: la auditoría registra la petición y no su ejecución (diseño: el worker no escribe en la cadena de auditoría); queda como decisión del dueño. Señalados por un solo juez, sin corregir: (a) la consulta de estado exige reautenticación reciente y el sondeo web puede fallar con REAUTH a mitad; (b) una petición pendiente no caduca y se ejecutaría si la fuente se suspende y se reactiva semanas después; (c) solo se compara UIDVALIDITY, no la conexión de la fuente; (d) un recibo sin posición responde MAIL_NOT_DELETABLE sin auditar. Mutación deliberada: se anuló la comprobación de Administrador o creador y fallaron 2 de 11 pruebas del caso de uso (el Líder ajeno pasa; el estado deja pasar a quien no debe); se revirtió y el árbol quedó limpio. No se leyó el código de imapflow: sigue sin comprobarse qué devuelve `messageDelete` con un UID inexistente.
