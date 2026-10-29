# Runbooks de operación

> **Borradores, pendientes de ensayo antes de producción.** El plan exige runbooks "escritos y ensayados antes de producción" (`plan.md`, "Respuesta a incidentes" y criterios del gate de producción). Ninguno de estos documentos se ha ensayado. Describen los pasos en términos de las operaciones del plan; los comandos concretos de infraestructura aún no existen y se marcan **por definir**. No inventes comandos al ensayarlos: defínelos y regístralos aquí.

Tipo de documento: how-to (guías de tarea para operadores con experiencia).

## Índice

| Runbook | Cuándo | Estado |
| --- | --- | --- |
| [Rotar DEK](rotate-dek.md) | Rotación trimestral o inmediata ante un incidente | Borrador |
| [Restaurar respaldo](restore-backup.md) | Simulacro trimestral o recuperación real | Borrador |
| [Responder a fuga de base de datos](data-breach-response.md) | Sospecha o confirmación de fuga de la base de datos | Borrador |
| [Responder a usuario o servidor comprometido](compromised-user-or-server-response.md) | Sospecha de usuario comprometido o de servidor comprometido | Borrador |
| [Transferir la Raíz](transfer-root.md) | Cambio planeado de dueño de la organización | Borrador |
| [Dar de alta una organización](provision-organization.md) | Organización nueva: comando de alta, contraseña inicial y custodia de los códigos de emergencia | Borrador |
| [Usar un código de emergencia](use-emergency-code.md) | La Raíz perdió su segundo factor y conserva su contraseña | Borrador |
| [Recuperar a la Raíz sin contraseña ni factores](recover-root.md) | La Raíz perdió contraseña y factores: control dual de los dos custodios y códigos de emergencia nuevos | Borrador |
| [Configurar y comprobar el correo](configure-mail.md) | Primer despliegue, cambio de servidor SMTP o invitaciones que no llegan | Borrador |
| [Operar con una sola instancia](single-instance-operation.md) | Todo despliegue, hasta que los contadores de intentos pasen a Redis | Borrador |

El plan menciona además un runbook de **caída total** (procedimiento de contingencia con los sobres sellados de recuperación). Aún no está redactado; se añade antes del gate de producción.

## Convenciones

- **Por definir**: un paso o comando que depende de infraestructura que aún no existe. Cada ensayo debe reemplazarlo por el valor real.
- **Responsables**: los roles propuestos aquí son una sugerencia; el plan fija la Raíz y los Administradores, pero no el equipo de guardia. Confirmar con el equipo.
- Nunca pegues secretos, DEK, tokens ni volcados de memoria en tickets, chats o este repositorio.
- Registra cada ejecución real o ensayo (fecha, quién, resultado, ajustes al runbook).
- Un incidente real activa el registro de [`threat-model.md`](../threat-model.md) ("Revisión").

## Plantilla

Un runbook nuevo se titula "Runbook: nombre de la operación", lleva debajo la advertencia de borrador pendiente de ensayo y contiene estas secciones, en este orden:

| Sección | Qué debe contener |
| --- | --- |
| Objetivo | Qué se logra y qué estado final se espera |
| Cuándo usarlo | Disparadores y señales (alertas, eventos). Cuándo no usarlo |
| Precondiciones | Accesos, autorizaciones, herramientas y estado previo del sistema |
| Pasos | Lista numerada; cada paso es una operación del plan y, si falta el comando concreto, se marca "por definir" |
| Verificación | Cómo se confirma que funcionó (pruebas, métricas, auditoría) |
| Rollback | Cómo se deshace, o qué hacer si falla a la mitad |
| Responsables | Quién ejecuta, quién aprueba y a quién se avisa |
| Historial de ensayos | Tabla con fecha, quién, resultado y cambios al runbook |

Los runbooks existentes de esta carpeta sirven de modelo.
