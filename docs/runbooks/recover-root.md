# Runbook: Recuperar a la Raíz sin contraseña ni factores

> **Borrador, pendiente de ensayo antes de producción.** El comando existe y está probado; el canal con el que se entrega la contraseña nueva y quiénes son los dos custodios son decisiones del equipo que siguen **por definir**.

Referencias: [ADR 0037](../adr/0037-root-recovery-dual-custody.md); [ADR 0027](../adr/0027-emergency-codes-root-reset-model.md); [`plan.md`](../../plan.md) ("Recuperación de la Raíz").

## Objetivo

Devolver el acceso a la Raíz que olvidó su contraseña **y** perdió sus factores, con el concurso de los dos custodios. Estado final: la Raíz tiene una contraseña de un solo uso, ningún factor ni sesión anterior sigue vigente, existen ocho códigos de emergencia nuevos repartidos entre los dos custodios, el hecho quedó auditado como evento crítico y los Administradores fueron avisados.

## Cuándo usarlo

- La Raíz no recuerda su contraseña y no tiene aplicación autenticadora, passkeys ni códigos de recuperación.
- **No sirve** si la Raíz conserva su contraseña: use [Usar un código de emergencia](use-emergency-code.md).
- **No sirve** si ya no quedan códigos de emergencia vigentes de cada custodio: es el caso de la **caída total** (runbook pendiente).
- **No sirve** para organizaciones dadas de alta antes de la migración 0013: sus códigos no tienen custodio asignado y el comando los rechaza.
- **Ningún Administrador puede restablecer a la Raíz.** Solo las dos personas que custodian los códigos.

## Precondiciones

- **Dos custodios presentes**, uno con un código vigente del grupo A y otro con uno del grupo B. Se verificó la identidad de la Raíz y el motivo de la petición por un canal independiente.
- Acceso de operaciones a la conexión de administración de la base de datos (`PROVISION_DATABASE_URL`). La API nunca ejecuta este procedimiento.
- Aviso previo a los Administradores: recibirán un correo de alerta y conviene que no lo confundan con un ataque.
- Para que el aviso salga: las variables de correo del comando (`MAIL_TRANSPORT=smtp`, `SMTP_*`, `MAIL_FROM`, `APP_ORIGIN`; ver [Configurar y comprobar el correo](configure-mail.md)). Sin ellas, la recuperación procede igual y el aviso queda registrado como incompleto.

## Pasos

1. Fija las variables no secretas del comando: `PROVISION_DATABASE_URL` desde el gestor de secretos y `ORG_SLUG` de la organización.
2. Cada custodio escribe su código de emergencia **sin dejarlo en el historial del shell**, con lectura silenciosa: `read -rs EMERGENCY_CODE_1` el custodio A y `read -rs EMERGENCY_CODE_2` el custodio B, y exporta ambas variables. No las pegues en tickets ni chats.
3. Ejecuta el comando de la API (`pnpm --filter @iam/api recover-root`, o `node dist/main.recover-root.js` en el despliegue).
4. Si el comando termina con `ROOT_RECOVERY_REJECTED`, no revela cuál comprobación falló. Revisa el slug, que los dos códigos sean de grupos distintos y que no se hayan usado; no pruebes combinaciones al azar. Tras un rechazo no cambió nada y quedó el evento `auth.root_recovery_rejected` en la auditoría. Una Raíz suspendida o desactivada también se rechaza: reactívala primero por el procedimiento correspondiente.
5. Si tuvo éxito, el comando imprime **una sola vez** la contraseña de un solo uso y los ocho códigos nuevos, cuatro por custodio. Entrega cada grupo a su custodio impreso, sin copias digitales, y la contraseña a la Raíz por el canal seguro (por definir). Limpia la pantalla y las variables (`unset EMERGENCY_CODE_1 EMERGENCY_CODE_2`).
6. Los custodios destruyen los papeles de los códigos usados y de los viejos que no se usaron: quedaron invalidados.
7. La Raíz entra con la contraseña de un solo uso, la cambia (es obligatorio) y registra un segundo factor nuevo; guarda los diez códigos de recuperación ordinarios nuevos y vuelve a agregar sus passkeys.
8. Un Administrador revisa en la auditoría el evento `auth.root_recovered`. Si aparece `auth.emergency_alert_incomplete`, el aviso falló o no había destinatarios: avisa a los Administradores por otro canal.
9. Averigua cómo se perdieron la contraseña y los factores; ante sospecha de robo sigue [Usuario o servidor comprometido](compromised-user-or-server-response.md).

## Verificación

- La Raíz entra con la contraseña nueva, la cambia y completa el segundo factor.
- Existe un evento `auth.root_recovered` con solo conteos (códigos emitidos y destinatarios), sin códigos ni contraseñas.
- Los dos códigos presentados y los anteriores no vuelven a aceptarse; las sesiones, factores y passkeys previos dejaron de servir.
- Los Administradores confirman que recibieron el aviso.

## Rollback y recuperación

- La recuperación es atómica: o queda completa o no cambia nada. Si el comando falló, vuelve a ejecutarlo.
- Si se perdió la salida antes de copiarla, los códigos y la contraseña no se pueden recuperar. Sin otros códigos vigentes de cada custodio es el caso de la **caída total**; con ellos, repite la recuperación.
- Una recuperación confirmada no se deshace.
- Si no quedan códigos de emergencia vigentes de los dos grupos, no hay recuperación en el sistema: escala a operaciones.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Custodio A y custodio B | Aportan cada uno un código vigente de su grupo, reciben los nuevos y destruyen los usados |
| Operaciones | Ejecuta el comando con la conexión de administración y entrega la contraseña |
| Raíz | Cambia la contraseña y registra sus factores nuevos |
| Administradores | Reciben el aviso y revisan el evento en la auditoría |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
