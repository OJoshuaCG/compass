# Runbook: Rotar DEK

> **Borrador, pendiente de ensayo antes de producción.** Los comandos de infraestructura están **por definir**.

Referencias: [`plan.md`](../../plan.md) secciones "Jerarquía de claves" y "Rotación"; [ADR 0004](../adr/0004-server-side-encryption-kms-per-org-dek.md) y [ADR 0005](../adr/0005-in-memory-dek-cache.md).

## Objetivo

Generar una versión nueva de la DEK de una organización y recifrar los secretos existentes con ella, de modo que la versión anterior quede `retired` y deje de usarse para cifrar. La KEK no se toca: su rotación anual la hace el KMS sin recifrar nada.

## Cuándo usarlo

- **Trimestral**, como rotación programada de la DEK (plan, "Rotación").
- **Inmediata** ante un incidente: servidor comprometido, fuga de la base de datos o sospecha de exposición de la DEK (ver [fuga de base de datos](data-breach-response.md) y [servidor comprometido](compromised-user-or-server-response.md)).

No lo uses para rotar la clave del índice ciego ni las huellas de contraseña por separado: se derivan de la DEK con HKDF y una etiqueta por uso, y cambian con ella.

## Precondiciones

- Respaldo reciente verificado ([restaurar respaldo](restore-backup.md)); el recifrado modifica todos los secretos.
- Autorización de al menos un Administrador y de la Raíz si es por incidente _(propuesto)_.
- El módulo `crypto` y el job de recifrado desplegados y probados en staging. Comando: por definir.
- Cola BullMQ y Redis saludables; sin otra rotación en curso para la misma organización.
- Ventana definida: durante el proceso conviven ambas versiones de DEK; el sistema sigue funcionando.

## Pasos

1. Registrar el inicio (motivo, quién, hora) para el evento de auditoría. Comando: por definir.
2. Generar la nueva DEK con `GenerateDataKey` del KMS y guardar solo `wrapped_dek` como nueva versión `active` en `data_keys`; la anterior pasa a `retired` (se conserva para descifrar). Comando: por definir.
3. Verificar que la nueva versión se resuelve: las nuevas escrituras usan la DEK activa y guardan `dek_version`.
4. Lanzar el job de BullMQ que recifra los secretos por lotes, con checkpoints y reintentos. Comando: por definir.
5. Monitorear el avance: lotes procesados, errores, latencia de descifrado y llamadas al KMS. Pausar si aumentan los errores.
6. Al terminar el recifrado, confirmar que ningún secreto conserva la versión anterior (`dek_version`).
7. Mantener la versión anterior `retired` hasta cerrar la verificación; su destrucción física se define según la política de retención (por definir con el equipo y el área legal).
8. Si la rotación fue por incidente, evaluar rotar también las credenciales de infraestructura y las credenciales de plataformas expuestas (ver [servidor comprometido](compromised-user-or-server-response.md)).

## Verificación

- Todos los `credential_secrets` y secretos del sistema (por ejemplo, TOTP del propio sistema) apuntan a la nueva `dek_version`.
- Revelar una contraseña y generar un código 2FA en una credencial de prueba funciona con la nueva DEK.
- La métrica de aciertos de la caché de DEK se recupera y no hay alertas de errores del KMS.
- Existe el evento de auditoría de la rotación y la cadena de auditoría verifica.
- Prueba de rotación con datos de ambas versiones conviviendo (requisito de la estrategia de pruebas del plan) ejecutada en staging.

## Rollback

- Si falla a la mitad: ambas versiones conviven, así que se puede pausar y reanudar el job desde su checkpoint; los secretos aún no recifrados se abren con la DEK `retired`.
- No elimines la DEK anterior hasta confirmar la verificación.
- Si la nueva DEK resulta inválida (no descifra): marcar la nueva versión como no usable, devolver la anterior a `active` y reintentar el paso 2. Comando: por definir.
- Si hay duda sobre la integridad de datos: restaurar desde respaldo ([restaurar respaldo](restore-backup.md)).

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Ingeniería de guardia | Ejecuta los pasos y monitorea |
| Administrador | Aprueba y verifica |
| Raíz | Aprueba si es por incidente |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
