# Comandos de operaciones (borrador)

Reúne, en un solo lugar, los comandos que los [runbooks](../runbooks/README.md) dejan como "por definir" (TODO L2). **Ningún comando de esta carpeta se ha ejecutado.** Los runbooks no se modificaron: cuando un comando se ensaye (TODO Q1), se pasa al runbook y aquí se marca como ensayado.

## Cómo leerlo

Cada paso lleva una de tres etiquetas:

| Etiqueta | Significa |
| --- | --- |
| **Existe** | El comando o el mecanismo ya está en el repositorio; se cita dónde. |
| **Propuesto** | Herramienta estándar (PostgreSQL, AWS CLI) con los datos del proyecto. Falta ensayarlo en un entorno aislado. |
| **Por definir** | No se puede escribir sin una decisión o sin código que no existe. Se dice cuál. |

Los valores entre `<...>` son datos que hoy no están fijados.

## Archivos

| Archivo | Runbook que completa | Resumen |
| --- | --- | --- |
| [restore-backup.md](restore-backup.md) | `restore-backup` | Restaurar la base desde los volcados en Wasabi. Hay un desajuste con el runbook: ver abajo. |
| [rotate-dek.md](rotate-dek.md) | `rotate-dek` | Casi todo ya existe. Quedan dos huecos reales, uno de ellos es código que falta. |
| [incident-response.md](incident-response.md) | `data-breach-response` y `compromised-user-or-server-response` | Rotar credenciales y revisar el uso del KMS. |
| [transfer-root.md](transfer-root.md) | `transfer-root` | Sin comandos: el flujo no está implementado y faltan decisiones de negocio. |

## Lo que cambia el panorama (léelo antes de ensayar)

1. **El runbook de restauración describe una infraestructura que ya no es la elegida.** Habla de PITR de 35 días y snapshots entre regiones (un servicio administrado). La decisión C1 (2026-10-28) fue PostgreSQL en servidor dedicado, con `pg_dump` programado por cron y copias en Wasabi. Con volcados no existe recuperación a un instante: el punto de recuperación es la hora del volcado.
2. **La frecuencia del volcado define el RPO real y no está decidida.** El plan pide un RPO de 5 minutos (C2, "a validar"). Un volcado por cron, aunque sea cada hora, no lo alcanza; para 5 minutos haría falta archivado continuo de WAL, que es otra decisión. Hasta decidirlo, no se debe prometer un RPO.
3. **Los volcados contienen datos personales y secretos cifrados**, y el volcado de roles contiene hashes de contraseñas de base de datos. Se deben cifrar antes de salir del servidor. Cómo (herramienta y custodia de la clave) está **por definir**.
4. **No se verificó cómo se autentica la API contra AWS KMS** (no aparece `AWS_ACCESS_KEY_ID` ni perfil en `apps/api/src/app/config.ts` ni en el ADR 0020). Los comandos de revocar el acceso al KMS dependen de eso.

## Decisiones que desbloquean lo "por definir"

| Decisión | Desbloquea |
| --- | --- |
| Frecuencia del volcado y, si se quiere RPO corto, archivado de WAL (C2, L2) | Restaurar respaldo |
| Bucket, prefijo y cifrado de los volcados en Wasabi | Restaurar respaldo |
| Cómo se autentica la API contra AWS | Incidente de servidor comprometido |
| Política de retención (C9) | Destruir DEK retiradas |
| Las 7 preguntas de negocio de J3 | Transferir la Raíz |
