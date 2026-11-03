# Inventario de datos personales (borrador para revisión legal)

Responde a la tarea A10 del `TODO.md`: qué datos de personas guarda el sistema, dónde, cómo se protegen y cuánto viven. Es un inventario técnico para que el área legal lo valide; no es una opinión jurídica. Se levantó leyendo las 30 migraciones (`db/migrations/`), `docs/database.md`, `docs/backend.md`, `docs/observability.md`, el registro de auditoría y el registrador de eventos. No se leyó ningún `.env*`, secreto ni dato real.

## Lo esencial

- **Datos de personas en claro:** correo, nombre visible, zona horaria, último ingreso, dirección IP y agente de usuario de las sesiones, y la IP de cada evento de auditoría. No están cifrados.
- **Lo que sí está protegido:** contraseñas (argon2id), códigos de recuperación (hash), semillas de TOTP y todo el contenido de la bóveda (cifrado con el módulo de criptografía).
- **El hueco principal:** casi ningún dato personal tiene una regla de borrado que funcione. No existe un camino para borrar a una persona.
- **Tres puntos que legal debe ver primero:** el texto libre de los motivos puede contener nombres (punto 4 de abajo); la IP queda en cada evento de auditoría, que además se quiere conservar de 2 años en adelante; y los registros del sistema no tienen plazo de conservación documentado.

## Dónde está cada dato

Todas las tablas tienen aislamiento por organización a nivel de fila. "En claro" significa sin cifrar.

| Dónde | Dato personal | Protección | Cuánto vive |
| --- | --- | --- | --- |
| `users` | Correo, nombre visible, idioma, zona horaria, último ingreso | En claro | Sin borrado. La aplicación no tiene permiso de `DELETE` sobre esta tabla |
| `invitations` | Correo de la persona invitada | En claro (el token va con hash) | Documentada como temporal; **ningún proceso la borra** |
| `sessions` | Dirección IP y agente de usuario | En claro (el token va con hash) | Caduca a los 30 minutos de inactividad; **ningún proceso borra las filas** |
| `audit_events` | IP, identificadores de quien actuó y del objetivo, metadatos | En claro; la cadena de hashes protege la integridad, no la privacidad | Retención propuesta de 6 meses en línea y 2 años archivados; **no implementada** (ADR 0024, propuesto) |
| `outbox_events` y `outbox_deliveries` | Identificadores de destinatarios (se infiere; no se leyó cada payload) | En claro | Los publicados se borran a los 7 días; los en cuarentena o sin publicar **no se borran nunca** |
| `idempotency_keys` | Copia de respuestas de la API (puede incluir datos personales; se infiere) | En claro | 24 h más 1 h de gracia; se purgan |
| `webauthn_credentials` | Nombre del dispositivo que escribe la persona (hasta 100 caracteres) | En claro | Sin borrado |
| `user_passwords`, `user_recovery_codes` | Hash de contraseña y de códigos | argon2id / hash | Sin borrado |
| `user_totp_factors`, `totp_handoffs` | Semilla de TOTP | Cifrada | Los traspasos tienen TTL de 5 minutos; **sin proceso de borrado** |
| `accounts` | Nombre, handle, alias de correo de recuperación, etiquetas de cuentas administradas (pueden ser personales) | En claro | Las archivadas se conservan |
| `credential_secrets` | Usuario, contraseña, notas | Cifrado, más un índice ciego por organización | Las versiones viejas se destruyen a los 30 días, pero la purga solo cubre el campo `totp_uri`; el resto espera la decisión C9 |
| `groups`, `roles`, `platforms`, vistas de correo, plantillas | Nombres de texto libre; un rol personal está ligado a una persona | En claro | Sin borrado |
| `access_requests` | Motivo escrito a mano | En claro | Sin borrado |
| `mail_sources` | Direcciones de correo o números de teléfono | En claro | Sin borrado |
| `mail_source_connections` | Usuario del buzón y destinatarios aceptados | En claro; la contraseña va cifrada | Sin borrado |
| `inbound_items` | Código o enlace extraído de un correo | Cifrado | TTL de 10 minutos: no se devuelve vencido, pero **no hay proceso que lo borre** |
| `inbound_receipts` | Huella del mensaje y dominio firmante; no guarda asunto ni remitente | Hash | Sin borrado |
| Contadores de intentos de ingreso | Clave del intento (correo o IP; se infiere) | Solo en memoria del proceso | Se pierde al reiniciar |
| Registros del sistema (logs) | Dirección de destino de correos, IP de las solicitudes, objetos de error | Enmascarado solo por nombre de campo | **Sin plazo de conservación documentado** |

## Puntos que conviene que legal vea

1. **No hay borrado de personas.** `users` no admite `DELETE`; una baja desactiva, no borra. Si una persona pide que se borren sus datos, hoy no hay camino.
2. **La limpieza automática cubre menos de lo que dicen los documentos.** Verificado en el código: el comando `purge-expired` solo borra llaves de idempotencia, retos de WebAuthn, eventos publicados de la cola con sus acuses, versiones reemplazadas del `totp_uri` y estados de sondeo de buzones archivados. No toca sesiones, invitaciones, traspasos de TOTP ni elementos de códigos entrantes, aunque `docs/backend.md` y `docs/database.md` las llaman temporales.
3. **La auditoría y el derecho a borrar chocan.** Los eventos guardan la IP y se pretende conservarlos en un archivo inmutable. Si una persona puede exigir que se borre su IP antes de los 2 años, el archivo inmutable no lo permite. Es la pregunta 2 de legal del [ADR 0024](../adr/0024-audit-retention-vs-revoke-delete.md), y hay que resolverla antes de elegir dónde vive el archivo.
4. **Texto libre sin filtrar.** El campo `reason` (hasta 500 caracteres) acompaña a los eventos `user.rank_changed`, `credential.totp_exported`, `access.emergency_granted` e `inbound.reset_revealed`. Quien lo escribe puede poner un nombre u otro dato personal y nada lo revisa. Los motivos de `access_requests` tienen el mismo riesgo.
5. **Los registros enmascaran por nombre de campo, no por contenido.** Un campo llamado `email`, `to` o `ip` no se enmascara; un correo dentro de un texto tampoco. El correo de desarrollo (`log-mailer.ts`) escribe el destinatario y el enlace de invitación **con su token** en el registro; la documentación dice que hay un bloqueo para que no se use en producción, que no verifiqué en esta revisión. El filtro de errores (`problem-details.filter.ts`) registra el objeto de error completo. El modelo de amenazas reconoce que aún no hay una prueba que demuestre que los registros no contienen secretos (A9b).
6. **Cifrado de los volcados.** Los respaldos contendrán todo lo anterior; el cifrado de los volcados está por definir ([comandos de operaciones](../ops-commands/README.md)).

## Qué no se verificó

- Quién puede leer cada columna: el repositorio no lo documenta por columna.
- Los payloads de `outbox_events` y `idempotency_keys`: lo escrito sobre ellos es inferencia.
- Si `credential_secrets` tiene purga para campos distintos de `totp_uri`: se leyó que no.
- La búsqueda de purgas cubrió `apps/api/src/modules/maintenance` y `outbox`; no se revisaron otras rutas de código que pudieran borrar filas.
- El volumen real de datos por tabla, y los datos que guardan los proveedores externos (correo saliente, Dokploy, Wasabi, AWS), que no se inventariaron.
