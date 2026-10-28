# Runbook: Rotar DEK

> **Borrador, pendiente de ensayo antes de producción.** El disparo de la rotación y el recifrado de los secretos TOTP ya tienen comando ([ADR 0040](../adr/0040-dek-rotation-and-cache-coherence.md)); el recifrado de `credential_secrets` y de los traspasos TOTP, y los comandos de infraestructura (KMS, retención), siguen **por definir**.

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
- El módulo `crypto` y el trabajo de recifrado desplegados y probados en staging. Comando de compilación: `pnpm --filter @iam/api build`.
- Sin otra rotación en curso para la misma organización. El recifrado no usa cola: es un proceso de línea de comandos, idempotente y reanudable.
- Ventana definida: durante el proceso conviven ambas versiones de DEK; el sistema sigue funcionando.

## Pasos

1. El motivo (`scheduled` o `incident`), quién y la hora los registra la propia rotación como evento de auditoría `crypto.dek_rotated`; no hay paso manual aparte.
2. Un Administrador (o la Raíz, si es por incidente) reautentica con su segundo factor y llama `POST /organization/data-key/rotate` con `{ "reason": "scheduled" }` o `{ "reason": "incident" }`. Genera la nueva DEK con el KMS, la guarda como versión `active` en `data_keys` y la anterior pasa a `retired` (se conserva para descifrar). La respuesta trae solo `fromVersion`, `toVersion` y `reason`.
3. Verificar que la nueva versión se resuelve: las nuevas escrituras usan la DEK activa y guardan `dek_version`.
4. Lanzar el recifrado por lotes: `pnpm --filter @iam/api reencrypt` (en producción, `node dist/main.reencrypt.js` con el mismo entorno que la API). Es reanudable: si se interrumpe, se vuelve a lanzar y retoma lo pendiente. Imprime solo conteos y sale con código 1 si quedó algo en una versión anterior o falló una organización.
5. Monitorear el avance con esa salida: recifrados, pendientes y organizaciones con fallo. Un secreto que no se puede abrir cuenta como pendiente y no se modifica: investígalo antes de retirar la versión anterior. Tras una rotación por incidente, reinicia la API para que suelte su caché de claves.
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
