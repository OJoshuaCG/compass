# Runbook: Restaurar con el KMS

> **Borrador, pendiente de ensayo antes de producción.** El adaptador de AWS KMS existe (L1) pero no se probó contra AWS real, y los comandos de infraestructura de restauración **no existen todavía** (L2 del `TODO.md`). Lo que sí está en el código: el esquema `data_keys`, el comando de migraciones y las DEK atadas a su clave y a su organización.

Referencias: [Restaurar respaldo](restore-backup.md); [Pérdida o borrado de la KEK](kek-loss.md); [Rotar DEK](rotate-dek.md); [ADR 0004](../adr/0004-server-side-encryption-kms-per-org-dek.md); [`plan.md`](../../plan.md) ("Respaldo y recuperación").

## Objetivo

Que una base de datos restaurada pueda descifrar sus secretos: que la clave del KMS que envolvió las DEK sea la misma (o una versión de ella que las abra) y que la restauración no deje DEK huérfanas ni referencias a claves inexistentes. Estado final: la API restaurada abre los secretos de cada organización.

## Cuándo usarlo

- Después de restaurar la base en otra región, otra cuenta o un entorno de simulacro.
- Al cambiar de cuenta o de región del KMS o al migrar de adaptador.
- Complementa a [Restaurar respaldo](restore-backup.md): ese runbook restaura los datos; este comprueba que la clave que los abre es la correcta.
- **No sirve** si la clave se perdió: [Pérdida o borrado de la KEK](kek-loss.md).

## Qué hay que saber

- Cada `data_keys.wrapped_dek` va atada a su `kms_key_ref` y a la organización mediante datos autenticados adicionales: una DEK solo se abre con la clave y el contexto con los que se envolvió.
- Restaurar la base **más** la misma clave (o una versión que abra lo anterior) basta para descifrar.
- Las versiones de DEK conviven. La rotación de DEK se ejecuta con `POST /organization/data-key/rotate` y el recifrado de los TOTP con el comando `reencrypt` ([ADR 0040](../adr/0040-dek-rotation-and-cache-coherence.md), [Rotar DEK](rotate-dek.md)).
- Con el adaptador local de desarrollo solo hay una referencia (`local:v1`) y no hay versiones de clave.
- Rewrapar las DEK de un KMS a otro **no está implementado** ni documentado en los ADR.

## Precondiciones

- Respaldo verificado y restaurado en un entorno aislado (primero se ensaya fuera del servicio real).
- Acceso de lectura a la clave del KMS que usaba la producción original, con permisos para descifrar. Quien administra el KMS (por definir) y el equipo de guardia (C11) localizados.
- Lista de `kms_key_ref` distintas en la base restaurada (consulta **por definir**, sobre `data_keys`).
- Sin el tráfico real apuntando aún a la base restaurada.

## Pasos

1. Restaura la base en un entorno aislado siguiendo [Restaurar respaldo](restore-backup.md) (comandos **por definir**).
2. Lista las referencias de clave que usa la base restaurada (`kms_key_ref` en `data_keys`) y comprueba que **cada una existe y está habilitada** en el KMS al que apuntará la API (por definir).
3. Apunta la API restaurada a esa misma clave: `KMS_ADAPTER=aws` con `AWS_KMS_KEY_ID` (id, ARN o alias) y `AWS_REGION`. Con otra clave o región, las DEK no se abren (el contexto de cifrado y la referencia de clave no coinciden).
4. Aplica migraciones pendientes con `node dist/main.migrate.js`.
5. Para **cada organización**: abre una DEK activa y descifra un secreto de prueba o de verificación. Un error de descifrado indica clave, versión o contexto distintos: **no continúes**, detén el proceso y ve a [Pérdida o borrado de la KEK](kek-loss.md).
6. Verifica la cadena de auditoría y el aislamiento por organización como en [Restaurar respaldo](restore-backup.md).
7. Si la restauración cambió de cuenta o región del KMS: confirma que la clave en destino es la **misma** (importada o replicada) y no una nueva con otro identificador. Una clave nueva no abre lo cifrado con la anterior.
8. Solo cuando todo lo anterior pase, apunta el tráfico real a la base restaurada.
9. Registra el resultado, el tiempo total y la pérdida de datos observada.

## Verificación

- Un secreto de prueba por organización se descifra con la clave restaurada.
- No hay `data_keys` activas con una `kms_key_ref` inexistente o deshabilitada.
- Las migraciones están al día y la cadena de auditoría es continua.
- El tiempo medido se compara con los objetivos del plan (5 min de pérdida, 4 h de recuperación, **sin validar**).

## Rollback

- Si el descifrado falla, no apuntes el tráfico real: deja la producción como estaba y repite desde el paso 2 con otra copia de la clave o de la base.
- Una restauración que no abre los secretos no se corrige creando una clave nueva (ver [Pérdida o borrado de la KEK](kek-loss.md), paso 5).
- No sobrescribas el respaldo usado hasta cerrar la verificación.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Equipo de guardia (por definir) | Restaura la base y ejecuta las comprobaciones |
| Administrador del KMS (por definir) | Confirma la clave y sus permisos |
| Raíz o Administrador | Autoriza apuntar el tráfico real a la base restaurada |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
