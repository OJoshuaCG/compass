# Runbook: Configurar y comprobar el correo

> **Borrador, pendiente de ensayo antes de producción.** Las variables y las reglas del adaptador están implementadas y probadas contra un servidor SMTP real de pruebas; el dominio, el servidor y los registros de DNS concretos están **por definir** por el equipo.

Referencias: [`docs/backend.md`](../backend.md) §6.3.1; decisión del dueño (2026-10-27): el correo sale del servidor SMTP del dominio propio de la organización, no de Gmail ni Outlook.

## Objetivo

Que la API envíe las invitaciones y el aviso de uso de un código de emergencia por el servidor SMTP del dominio propio, y que los mensajes lleguen a la bandeja de entrada y no a spam.

## Cuándo usarlo

- Al desplegar por primera vez: en producción el envío real es obligatorio y la API no arranca con otro transporte.
- Al cambiar de servidor SMTP, de remitente o de credenciales.
- Cuando las invitaciones no llegan.

## Precondiciones

- Acceso al servidor SMTP del dominio (servidor, puerto, usuario y contraseña) y al DNS del dominio. Los registros de DNS son una tarea del dueño, fuera del sistema.
- El gestor de secretos de la infraestructura para guardar la contraseña SMTP. Nunca va en el repositorio, en un archivo de entorno versionado ni en un ticket.
- El origen público de la aplicación ya definido (`APP_ORIGIN`): de él salen los enlaces de las invitaciones.

## Pasos

1. Define las variables de entorno de la API:

   | Variable | Qué poner |
   | --- | --- |
   | `MAIL_TRANSPORT` | `smtp`. El valor `log` solo existe en desarrollo y la API se niega a arrancar con él en producción |
   | `SMTP_HOST` | Servidor SMTP del dominio. Obligatorio con `smtp` |
   | `SMTP_PORT` | 587 por defecto |
   | `SMTP_SECURITY` | `starttls` (por defecto) o `tls`. `none` se rechaza en producción |
   | `SMTP_USER` y `SMTP_PASSWORD` | Se definen juntas o ninguna. La contraseña viene del gestor de secretos |
   | `MAIL_FROM` | Remitente del dominio propio, por ejemplo `IAM <no-reply@sudominio>`. Obligatorio con `smtp` |

2. Pide al dueño del dominio que publique en el DNS los registros SPF, DKIM y DMARC del dominio de envío. Sin ellos, muchos proveedores mandan las invitaciones a spam o las rechazan.
3. Arranca la API. La configuración se valida al inicio: si es inválida, el servicio no arranca y el error lista las claves y el tipo de problema, nunca los valores.
4. Envía una invitación a una dirección que controles, en un buzón de otro proveedor (por ejemplo, uno personal).

## Verificación

- El mensaje llega a la bandeja de entrada, en el idioma del destinatario, con el enlace de la invitación en el dominio de la aplicación y el vencimiento en hora UTC.
- En las cabeceras del mensaje recibido, la autenticación del remitente (SPF, DKIM y DMARC) aparece como aprobada. Cómo consultarla depende del buzón de prueba.
- El enlace abre la pantalla de aceptación y la invitación aparece en la pestaña de invitaciones de la persona que la envió.
- Ni los registros de la API ni la auditoría contienen la contraseña SMTP ni el token del enlace.

## Rollback y diagnóstico

- Si el envío falla, crear una invitación falla completa y no queda una invitación sin enviar. Los errores del proveedor se sustituyen por un error genérico (podrían citar destinatario o contenido): el detalle está en los registros del servidor SMTP.
- Si el aviso de un código de emergencia no sale, se audita `auth.emergency_alert_incomplete`; corrige el correo y avisa a los Administradores por otro canal.
- Si no llegan, revisa primero SPF, DKIM y DMARC y la reputación del dominio, antes que la API.
- Para volver a la configuración anterior, restaura las variables previas y reinicia la API.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Operaciones | Define las variables y los secretos, arranca la API y hace la prueba |
| Dueño del dominio | Publica los registros SPF, DKIM y DMARC |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
