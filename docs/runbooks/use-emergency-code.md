# Runbook: Usar un código de emergencia de la Raíz

> **Borrador, pendiente de ensayo antes de producción.** El mecanismo está implementado y probado; el procedimiento de custodia y los canales de aviso están **por definir** con el equipo.

Referencias: [`plan.md`](../../plan.md) ("Recuperación de la Raíz"); [`docs/business/authentication.md`](../business/authentication.md) §7; [`docs/backend.md`](../backend.md) §3.6; [ADR 0027](../adr/0027-emergency-codes-root-reset-model.md).

## Objetivo

Devolver el acceso a la Raíz que perdió su segundo factor (aplicación autenticadora y passkeys) pero conserva su contraseña. Estado final: la Raíz tiene un segundo factor nuevo, el uso quedó auditado como evento crítico y los Administradores fueron avisados.

## Cuándo usarlo

- La Raíz perdió su teléfono, su aplicación autenticadora o sus passkeys y no tiene sus códigos de recuperación ordinarios.
- **No sirve** si la Raíz olvidó su contraseña: el código no la sustituye. Si además perdió los factores, usa [Recuperar a la Raíz sin contraseña ni factores](recover-root.md).
- **Ningún Administrador puede restablecer a la Raíz** (decisión del dueño, 2026-10-27). Solo las personas que custodian los códigos.

## Precondiciones

- La Raíz conoce su contraseña actual.
- Un custodio entrega a la Raíz uno de los ocho códigos, en persona o por un canal seguro (por definir). Se verificó la identidad de quien lo pide.
- Se sabe que el uso alerta por correo a todos los Administradores activos y queda como evento crítico: conviene avisarles antes para que no lo confundan con un ataque.
- El correo del sistema funciona ([Configurar y comprobar el correo](configure-mail.md)); si no, el aviso falla y queda registrado.

## Pasos

1. La Raíz entra con su correo y su contraseña. En el paso del segundo factor elige usar un código de recuperación y escribe el código de emergencia.
2. El sistema restablece el segundo factor de la Raíz: la aplicación autenticadora, las passkeys y los códigos de recuperación ordinarios dejan de servir. La sesión que lo usó pasa a "registro del segundo factor pendiente" y se cierran las demás sesiones de la Raíz.
3. La Raíz registra un segundo factor nuevo con una aplicación autenticadora y guarda los diez códigos de recuperación ordinarios nuevos, que se muestran una sola vez.
4. Desde **Seguridad**, la Raíz vuelve a agregar sus passkeys, si las usaba.
5. El custodio y la Raíz destruyen el papel del código usado y anotan cuántos códigos de emergencia siguen sin usar. Los demás siguen vigentes.
6. Un Administrador revisa en la auditoría el evento `auth.emergency_code_used` y confirma que corresponde a este procedimiento. Si aparece `auth.emergency_alert_incomplete`, el aviso por correo falló o no había destinatarios: avisa a los Administradores por otro canal.
7. Averigua por qué se perdió el segundo factor. Si hay sospecha de robo del dispositivo o de la contraseña, cambia la contraseña de la Raíz y sigue [Usuario o servidor comprometido](compromised-user-or-server-response.md).

## Verificación

- La Raíz entra con su factor nuevo y ve sus sesiones en **Mis sesiones**.
- Existe un evento `auth.emergency_code_used` crítico con el número de destinatarios del aviso, sin ningún código en su contenido.
- Los Administradores confirman que recibieron el aviso.
- El código usado no vuelve a aceptarse.

## Rollback y recuperación

- Un código usado no se puede devolver. Si el procedimiento se interrumpe antes del paso 3, la Raíz puede volver a entrar con su contraseña y completar el registro del segundo factor nuevo.
- Los códigos de emergencia nuevos solo se emiten al recuperar a la Raíz con [su procedimiento](recover-root.md), que exige a los dos custodios. Usar un código aquí no emite más: cuando queden pocos, escala al equipo antes de agotarlos.
- Si olvidó la contraseña y perdió los factores, usa [Recuperar a la Raíz sin contraseña ni factores](recover-root.md).

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Custodio | Entrega un código tras verificar la identidad de la Raíz y destruye el usado |
| Raíz | Entra con la contraseña y el código, y registra el factor nuevo |
| Administradores | Reciben el aviso y revisan el evento en la auditoría |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
