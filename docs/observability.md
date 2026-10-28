# Observabilidad

Este documento fija qué se registra, qué métricas y alertas son el mínimo y qué hay hoy en el código. La fuente del diseño es la sección "Observabilidad" de [`plan.md`](../plan.md); aquí se separa lo **implementado** de lo **planeado**, para que nadie dé por activa una alerta que no existe.

Tipo de documento: referencia para quien opera o amplía el sistema.

## Estado de un vistazo

| Capacidad | Estado |
| --- | --- |
| Logs en JSON con `pino` | Implementado |
| Redacción de claves sensibles por configuración | Implementada; sin prueba de punta a punta (A9b) |
| Identificador de petición en logs y respuestas | Implementado |
| Contexto de organización y de actor en cada línea | **No existe**: solo `requestId` en el error de la petición |
| Retención de 30 días de logs | Por definir (depende de la nube, C1) |
| Verificación de vida (`/health/live`) | Implementada |
| Verificación de disponibilidad (`readiness`: base de datos, KMS) | **No existe** |
| Trazas y métricas con OpenTelemetry | **No existe**: ninguna dependencia instalada |
| Alertas | **No existen**; las de seguridad que sí hay salen por correo, no por métricas |
| Verificación diaria de la cadena de auditoría | **No existe** (la tarea corresponde al worker, H1) |

## Logs

### Qué se escribe hoy

- Formato JSON de `pino`, creado en `apps/api/src/shared/infrastructure/logger.ts`. El nivel sale de la configuración validada al arrancar.
- Cada petición recibe un identificador (`uuidv7`) que viaja en la cabecera de respuesta `x-request-id` y en el registro del error. Las respuestas de error de la API llevan ese mismo `requestId`, para que soporte rastree el caso sin ver detalles internos.
- Eventos que hoy se registran: arranque del servidor, resultado de las migraciones, errores no controlados de peticiones y, con el transporte de correo de desarrollo, el aviso de que se "envió" un correo.

### Redacción

- Se redactan, a profundidad 0, 1 y 2, las claves `password`, `secret`, `token`, `totp`, `code`, `authorization`, `cookie`, `ciphertext` y `wrapped_dek`.
- Se redactan además las cabeceras `authorization`, `cookie` y `set-cookie`, y **todo** el cuerpo de la petición.
- **Límite conocido (D4):** la redacción depende de los nombres de clave y de una profundidad máxima de 2. Un secreto en una clave con otro nombre, o más profundo, no se redacta. El transporte de correo de desarrollo registra el enlace con su token; solo lo protege el bloqueo que impide usarlo en producción.

### Lo que nunca debe aparecer

Contraseñas, tokens, códigos de segundo factor o de recuperación, cookies, DEK, texto cifrado y cuerpos de las rutas de revelación, códigos y handoff. Si aparece uno en un log, es un incidente: sigue [Fuga de la base de datos](runbooks/data-breach-response.md) en lo que aplique y rota lo expuesto.

### Pendiente

- **A9b:** prueba que envíe secretos conocidos por los endpoints sensibles y verifique que no aparecen en los logs capturados (el plan la exige).
- Añadir a cada línea el contexto de organización y de actor, y el módulo y caso de uso, como pide el plan.
- Definir la retención y el destino de los logs cuando se elija la nube (C1).

## Métricas mínimas (planeadas)

Ninguna existe todavía. El plan pide OpenTelemetry y estas métricas de negocio y seguridad, además de las técnicas:

| Grupo | Métrica |
| --- | --- |
| Autenticación | Ingresos exitosos y fallidos, reautenticaciones, bloqueos |
| Secretos | Revelaciones, códigos de segundo factor emitidos y exportaciones, por hora, por persona y por organización |
| Criptografía | Llamadas al KMS, tasa de aciertos de la caché de DEK, latencia de descifrado |
| Auditoría | Latencia de la escritura serializada y errores por tiempo de espera del bloqueo (ADR 0023; medición abierta en G6) |
| Plataforma | Latencia y errores por ruta, conexiones a la base de datos |

## Alertas mínimas (planeadas)

| Alerta | Origen del requisito | Hoy |
| --- | --- | --- |
| Borrado o deshabilitación de la KEK | `plan.md`, "Respaldo de claves" | No existe |
| Cadena de auditoría rota | `plan.md`, "Encadenamiento" | No existe (falta el job diario) |
| Revelaciones por encima del límite por hora | `plan.md`, "Límite de revelaciones" | No existe (fase 1b) |
| Deriva del reloj mayor a 2 s | `plan.md`, "Sincronización de hora" | No existe |
| Uso de un código de emergencia de la Raíz | ADR 0027 y ADR 0037 | **Existe**: aviso por correo a los Administradores |
| Errores del KMS | `docs/threat-model.md` | No existe |

Cuando se decida el destino de las alertas y el equipo de guardia (C11), cada fila debe decir quién la recibe y qué runbook sigue.

## Cómo ampliar esto sin romper la seguridad

- Un campo nuevo en un log o en una métrica no puede llevar datos personales sin enmascarar ni secretos. Las etiquetas de las métricas no deben incluir correos, nombres ni identificadores de credenciales.
- Los eventos de auditoría **no** sustituyen a los logs ni al revés: la auditoría es la evidencia con cadena de hashes; los logs son diagnóstico.
- Toda dependencia nueva (por ejemplo, las de OpenTelemetry) necesita aprobación, versión exacta y la espera de 7 días.
