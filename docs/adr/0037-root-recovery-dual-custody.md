# ADR 0037: Recuperación de la Raíz por operaciones con control dual de los custodios

- **Estado**: Aceptada (2026-10-27). La decisión de diseño es del dueño (`TODO.md` C3); se implementó por encargo explícito y el dueño delegó el cierre en la misma fecha por no estar disponible para ratificarla en persona
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) ("Autenticación del propio sistema", recuperación de la Raíz); [ADR 0027](0027-emergency-codes-root-reset-model.md); [ADR 0016](0016-append-only-audit-hash-chain.md); [ADR 0033](0033-reauthentication-totp-and-passkey.md); [`docs/threat-model.md`](../threat-model.md); [runbook](../runbooks/recover-root.md).

## Contexto

El ADR 0027 permite que quien conserva la contraseña de la Raíz recupere el segundo factor con un código de emergencia. Deja dos huecos que los documentos repiten como limitación (handoff §4 punto 4; `TODO.md` C3 y G2):

- Si la Raíz olvida la contraseña **y** pierde sus factores, el sistema no tiene recuperación: un código de emergencia no sustituye a la contraseña.
- No existe forma de emitir códigos de emergencia nuevos.

Restricciones ya decididas: ningún Administrador puede restablecer a la Raíz (solo recibe la alerta); los códigos los custodian dos personas fuera del sistema, cada una con papeles distintos; usar un código es un evento crítico que se audita y se avisa; los códigos se guardan solo como hash; el alta de organizaciones es un comando de operaciones con conexión de administración, nunca una ruta HTTP. Toda vía que permita recuperar a la Raíz es también una vía para tomarla.

## Decisión

La recuperación es un **comando de operaciones** (`recover-root`), con la conexión de administración del alta y nunca desde la API, que exige **control dual verificable con los propios códigos de emergencia**:

- Cada código de emergencia lleva un **grupo de custodia** (`A` o `B`). El alta reparte cuatro y cuatro: cada custodio recibe los papeles de un solo grupo.
- El comando recibe dos códigos de emergencia vigentes de la misma Raíz y **de grupos distintos**. Un solo custodio, aunque conserve todos sus papeles, no puede ejecutarlo. No se introduce ningún secreto nuevo que custodiar.
- Antes de cualquier cambio se verifica en la base de datos, en la misma transacción que el resto, que los dos códigos existen, son de emergencia, están sin usar y pertenecen a grupos distintos. Si falla cualquier comprobación no se cambia nada y el motivo no revela cuál código falló.

Cuando la verificación pasa, en **una sola transacción**:

- se consumen los dos códigos usados;
- se revocan todos los segundos factores de la Raíz (TOTP, passkeys y códigos de recuperación ordinarios);
- se establece una contraseña inicial nueva de un solo uso con cambio obligatorio, se deja a la Raíz en estado `invited` y se cierran todas sus sesiones;
- se **invalidan los códigos de emergencia restantes** y se emiten ocho nuevos (cuatro por grupo), que se imprimen una sola vez;
- se escribe el evento crítico `auth.root_recovered` en la cadena de auditoría (sin actor, como el alta; solo registra cuántos códigos se emitieron y a cuántos Administradores se avisó, nunca códigos ni contraseñas).

Solo se recupera a una Raíz `invited` o `active`: una Raíz suspendida o desactivada se decidió a propósito y el control dual no la reactiva. Todo intento rechazado sobre una Raíz existente se audita como `auth.root_recovery_rejected` (`denied`, sin metadatos); una organización inexistente no tiene dónde auditarse y solo se rechaza. Si la auditoría del rechazo falla, quien prueba ve el mismo rechazo.

Después de confirmar, y como mejor esfuerzo, se avisa por correo a cada Administrador activo. Si no hay transporte de correo, no hay destinatarios o algún envío falla, se audita `auth.emergency_alert_incomplete` y el comando lo dice en su salida: un fallo de alerta nunca deja a la Raíz sin poder recuperarse, pero tampoco pasa en silencio. Ningún fallo posterior a la confirmación (el envío, su auditoría) impide imprimir la contraseña y los códigos nuevos: son lo único que permite repetir la recuperación.

La recuperación **no** resuelve el caso de códigos de emergencia agotados o perdidos por completo: sin ellos no hay forma de demostrar control dual desde el sistema. Ese caso queda en el procedimiento de caída total (sobres sellados y administración directa de la base de datos), fuera de este ADR.

## Alternativas consideradas

- **Un solo código de emergencia, ejecutado por una persona de operaciones**: descartada. Un papel robado o un operador comprometido bastaría para tomar la cuenta de mayor privilegio.
- **Dos códigos cualesquiera, sin grupo de custodia** _(inferida del plan)_: descartada. Un custodio con cuatro papeles reuniría el quórum él solo, y el control dual sería nominal.
- **Aprobaciones de dos operadores con credenciales propias** _(inferida del plan)_: descartada por ahora. Exige un sistema de identidad de operaciones que no existe y un secreto nuevo por persona.
- **Que el comando sea un endpoint protegido por permiso**: descartada. Convertiría la API en una vía de toma de la Raíz; el alta ya demuestra que operaciones va por conexión de administración.
- **Que un Administrador o dos puedan recuperar a la Raíz**: descartada por el dueño en el ADR 0027.

## Consecuencias

- **Positivas**: la Raíz que lo pierde todo se recupera sin tocar la base de datos a mano; el control dual lo hace cumplir el código y no solo el procedimiento; ningún secreto nuevo; la reemisión resuelve la falta de códigos nuevos tras una recuperación; todo queda auditado y avisado.
- **Negativas o costos**: hace falta reunir a los dos custodios; un código de grupo distinto de `A` o `B` o sin grupo (organizaciones creadas antes de este ADR) no sirve para el comando y esas organizaciones requieren una reemisión manual antes de depender de él; la alerta por correo es de mejor esfuerzo; el caso de códigos agotados sigue siendo manual.
- **Verificación**: pruebas de integración con base de datos real (dos grupos distintos recuperan; mismo grupo, código usado, código de recuperación ordinario, código de otra organización y código inexistente se rechazan sin cambios; atomicidad; auditoría sin secretos); prueba unitaria del caso de uso; revisión adversarial con dos revisores ciegos; mutación manual del control dual.

## Notas de uso

- Reemisión sin recuperar (por ejemplo, tras la transferencia de la Raíz, `runbooks/transfer-root.md` paso 6) no está cubierta: es un seguimiento propio que no debe resolverse reduciendo el control dual.
- El runbook [`recover-root.md`](../runbooks/recover-root.md) es borrador hasta ensayarse antes de producción.
