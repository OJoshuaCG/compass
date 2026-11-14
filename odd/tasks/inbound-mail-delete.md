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
| D1 | Migración 0037: columnas de UID en `inbound_receipts`, permiso nuevo en `permission_rank_ceiling()` | inline | Escrita (sin probar contra la base) |
| D2 | Registrar el UID al procesar cada mensaje (recorder y sondeo) | inline | Escrito, typecheck verde; pruebas por correr |
| D3 | Puerto y adaptador IMAP de borrado (bloqueo de escritura) | inline | Pendiente |
| D4 | Caso de uso `DeleteInboundMail`, permiso, reautenticación, auditoría y negaciones | inline | Pendiente |
| D5 | Controlador, contratos, textos de error | inline | Pendiente |
| D6 | Vista previa del correo (asunto, y cuerpo bajo `reveal_reset`) | inline | Pendiente |
| D7 | Web: acción de borrar y diálogo | `frontend-developer` | Pendiente |
| D8 | Pruebas, modelo de amenazas, ADR 0045, docs | inline | Pendiente |
| D9 | Jueces ciegos, mutación deliberada | jueces | Pendiente |

## Bitácora

- L1 (2026-11-14): decisión del dueño, texto en S5 a S7.
