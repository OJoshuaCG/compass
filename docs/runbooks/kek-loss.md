# Runbook: Pérdida o borrado de la KEK

> **Borrador, pendiente de ensayo antes de producción.** El adaptador de AWS KMS existe (L1, [ADR 0020](../adr/0020-reference-cloud-aws.md)) pero **no se probó contra AWS real**; el adaptador local no sirve en producción. Los pasos concretos del KMS real (consola o línea de comandos de AWS) siguen **por definir**.

Referencias: [ADR 0004](../adr/0004-server-side-encryption-kms-per-org-dek.md); [ADR 0020](../adr/0020-reference-cloud-aws.md); [`plan.md`](../../plan.md) ("Cifrado", "Respaldo de claves"); [Rotar DEK](rotate-dek.md); [Restaurar con el KMS](restore-with-kms.md).

## Objetivo

Recuperar el acceso a la clave que protege las DEK cuando se perdió, se deshabilitó o se programó su borrado, o, si no es posible, acotar el daño y reconstruir los secretos desde sus fuentes. Estado final: la KEK vuelve a estar disponible y descifra, o los secretos perdidos están identificados y se están rehaciendo.

## Qué está en juego

- Cada secreto va cifrado con una DEK por organización; cada DEK se guarda envuelta (`data_keys.wrapped_dek`) con la KEK y la referencia de la clave (`kms_key_ref`).
- **Sin la KEK no se puede abrir ninguna DEK y, por tanto, ningún secreto de la organización** (ADR 0004, consecuencias). Una base de datos restaurada no ayuda: lo que falta es la clave.
- El borrado de una clave del KMS tiene una **ventana de espera de 30 días** según el plan: mientras dure, el borrado se puede cancelar. Pasada la ventana es irreversible.

## Cuándo usarlo

- Alerta crítica de borrado o deshabilitación de la KEK (el plan la define; la alerta real **no existe** aún).
- Errores de descifrado en todas las operaciones de una o varias organizaciones tras un cambio en el KMS, un cambio de región o una restauración.
- En desarrollo con el adaptador local: el archivo de la clave (`LOCAL_KMS_KEY_FILE`, por defecto `.local-kms/kek.key`) se perdió. **Peligro:** si la API arranca sin el archivo, crea una KEK nueva y las DEK existentes quedan inservibles. **Detén la API antes de cualquier otra acción.**
- **No sirve** para sospecha de uso indebido de la KEK sin pérdida: siga [Fuga de la base de datos](data-breach-response.md).

## Precondiciones

- Quien puede administrar el KMS y quien puede detener la API están localizados. Equipo de guardia **por definir** (C11).
- Permiso para **detener el tráfico** que descifra secretos mientras se diagnostica.
- Acceso al registro del KMS (quién deshabilitó o programó el borrado y cuándo): **por definir** según el proveedor.

## Pasos

1. **Detén lo que descifra**: pon la API en mantenimiento o deténla. Impide que un arranque con una clave nueva sobrescriba o genere claves nuevas (peor en el adaptador local).
2. Determina qué pasó: ¿clave deshabilitada, borrado programado, borrada, permisos retirados o archivo perdido? Anota hora y autor.
3. **Si el borrado está programado o la clave solo está deshabilitada**: cancela el borrado y vuelve a habilitarla (comandos del KMS **por definir**). Comprueba que descifra (paso 7).
4. **Si hay una copia de la KEK** (el plan habla de "Respaldo de claves", pero **no hay mecanismo implementado**): restáurala según su procedimiento (**por definir**) y la misma referencia de clave (`kms_key_ref`). Comprueba (paso 7).
5. **Si la KEK es irrecuperable**: los secretos de las organizaciones afectadas **no se pueden recuperar del sistema**. Declara el incidente y:
   1. Avisa a la Raíz y a los Administradores de cada organización afectada, con el alcance.
   2. Genera una KEK nueva y las DEK nuevas por organización (procedimiento **por definir**; hoy no hay un comando de reconstrucción).
   3. Rehaz los secretos desde sus fuentes: cambia la contraseña en cada plataforma y vuelve a registrar los segundos factores, usando los **sobres sellados** de recuperación para las cuentas críticas ([Caída total](total-outage.md), pasos 8 y 9).
   4. Trata como comprometidos los secretos que no se puedan verificar.
6. Si la causa fue una acción humana o un permiso excesivo, revisa quién pudo borrar o deshabilitar la clave y corrige la política del KMS (protección contra borrado, doble aprobación: **por definir**).
7. Comprueba que se puede abrir una DEK y un secreto de prueba de cada organización afectada antes de volver a abrir el tráfico.

## Verificación

- Un secreto de prueba por organización se revela correctamente con la KEK recuperada o con la nueva.
- Ninguna fila de `data_keys` activa apunta a una `kms_key_ref` inexistente (consulta de comprobación **por definir**).
- Las alertas de borrado y de deshabilitación quedan configuradas (por definir) y ensayadas.
- El incidente quedó en el registro de [`threat-model.md`](../threat-model.md) ("Revisión").

## Rollback

- Cancelar un borrado programado es seguro y reversible mientras dure la ventana.
- Una KEK nueva **no** vuelve legible lo cifrado con la anterior; generar una nueva y apuntar las DEK viejas a ella no funciona porque no pueden descifrarse con ella.
- No hay forma de deshacer un borrado ya efectivo: la vía es el paso 5.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Equipo de guardia (por definir) | Detiene la API, diagnostica y recupera la clave |
| Administrador del KMS (por definir) | Cancela borrados, habilita la clave y restaura copias |
| Raíz y Administradores | Reciben el aviso; rehacen secretos si la clave es irrecuperable |
| Dueño de la organización | Decide el alcance de la comunicación a las personas afectadas |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
