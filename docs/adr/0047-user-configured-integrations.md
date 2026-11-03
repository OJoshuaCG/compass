# ADR 0047: Integraciones configurables por la persona administradora (alertas por Telegram y recepción de SMS por API genérica)

- **Estado**: Aceptada por **encargo del dueño (2026-11-03)**: los dos canales, el SMS por consulta, el proveedor genérico y el nivel de detalle de los avisos de seguridad. Implementación en `odd/tasks/integrations.md`.
- **Fecha**: 2026-11-03
- **Referencias**: [ADR 0045](0045-inbound-codes-mail-and-sms.md) §8 (`SmsProviderPort`, SMS sin proveedor elegido), [ADR 0015](0015-mandatory-mfa-passkeys-preferred.md) (el SMS no es un factor dentro del sistema), [ADR 0035](0035-transactional-outbox-for-events.md) (cola transaccional), [ADR 0040](0040-dek-rotation-and-cache-coherence.md) (versiones de DEK), `docs/observability.md` (tabla de alertas), `TODO.md` (R2, C11, IC-7).

## Contexto

El dueño pidió que dos capacidades las configure la propia persona administradora con sus llaves de API, sin que el producto fije un proveedor:

1. **Notificaciones por Telegram de dos tipos** (decisión del dueño, 2026-11-03; C11):
   - **Infraestructura (Raíz)**: estado de toda la plataforma, fallos y lo que requiere atención de programación.
   - **Seguridad (Administrador)**: eventos relevantes para seguir el uso en tiempo casi real, como revelar una contraseña, consultar cierta información, un inicio de sesión nuevo o un segundo factor nuevo. Lo puede configurar el Administrador y **abrir a otras personas** para que también las reciban.
2. **Recepción de SMS con códigos**, mediante una API **genérica y personalizable**, compatible con cualquier proveedor que se pueda consultar por HTTP (ADR 0045 §8 dejó el proveedor sin elegir).

Hechos verificados en el repositorio (mapa del 2026-11-03):

- El único permiso exclusivo de la Raíz es `org.settings` (techo 0, `permission-catalog.ts`). Añadir un permiso exige catálogo, techo, migración que redefine `permission_rank_ceiling()` completa (patrón de la migración 0026) y etiquetas de i18n.
- Los secretos se sellan con `SecretCipher.encrypt` y un contexto `{organizationId, resourceId, field, version}`; la contraseña del buzón IMAP ya sigue ese patrón y tiene su recifrador registrado en `main.reencrypt.ts`.
- `NetworkGuard` bloquea rangos privados y devuelve la IP fijada contra DNS rebinding, pero **no** impone puertos, esquemas, redirecciones, tiempo máximo ni tamaño de respuesta. **No existe un cliente HTTP genérico** en `apps/api/src`.
- La cola transaccional ya tiene manejadores por tipo de evento que llaman al puerto `Mailer`; un notificador de Telegram encaja como otro manejador.
- La web no tiene un área de configuración todavía.

El riesgo principal es que una URL definida por una persona convierte a la API en un cliente HTTP con acceso a la red interna (**SSRF**), y que la llave de un tercero es un secreto nuevo que cuidar.

## Decisión

Se crea el módulo **integraciones**, con dos tipos cerrados y una configuración por organización.

**Modelo.** Una tabla `integrations` (organización, tipo, nombre, estado activa/archivada, configuración no secreta en JSON validado por esquema) y una tabla de secretos con el patrón del buzón IMAP (texto cifrado, nonce, `dek_version`, `secret_version`). Toda tabla lleva organización, índice y política de aislamiento en la misma migración.

**Permisos (propuesta, a confirmar por el dueño).**

- `alerts.infra.manage`, techo **0** (solo Raíz): configurar, probar y archivar el canal de infraestructura. Con reautenticación y auditoría crítica, igual que `org.settings`.
- `alerts.security.manage`, techo **1** (Raíz y Administrador): configurar el canal de seguridad y **administrar quién lo recibe**. Con reautenticación y auditoría crítica.
- **Cada destinatario vincula su propio Telegram**: la persona abre el bot y confirma con un código de un solo uso. El Administrador puede invitar o quitar destinatarios, pero **no puede apuntar los avisos a un chat que no confirmó su dueño**. Cada persona puede darse de baja sola.
- `integration.sms.manage`, techo **1** (Raíz y Administrador): configurar la API de SMS. Las vistas y la lectura de códigos siguen gobernadas por los permisos de ADR 0045.
- La decisión de acceso la toma el motor de autorización; la guarda del controlador no es la autorización.

**Secretos.** La llave de API y el token del bot se cifran con el módulo de criptografía, con su propio campo de contexto. Nunca se devuelven: la lectura expone solo "configurado sí/no" y la fecha de la última rotación. Se añade su recifrador a `main.reencrypt.ts` para que la rotación de DEK los cubra.

**Telegram.**

- Son **dos canales independientes**, cada uno con su propio bot y su propio token: el de infraestructura solo lo ve la Raíz; el de seguridad, sus destinatarios.
- Los avisos de seguridad se limitan a una lista cerrada de eventos y **no incluyen el valor de ningún secreto**. El nivel de detalle (por ejemplo, si nombra la cuenta revelada) queda como pregunta abierta; por defecto, tipo de evento, quién actuó y hora.
- El identificador de chat es dato personal: entra al inventario de datos personales (A10) y se borra al darse de baja la persona.
- El destino es fijo (`api.telegram.org`, HTTPS, puerto 443); la persona solo aporta token e identificador de chat. No hay URL libre.
- Se envía desde un manejador de la cola transaccional, con reintentos de la cola; un fallo de Telegram nunca bloquea la acción que originó la alerta.
- El mensaje se arma con una lista cerrada de campos (tipo de alerta, hora, organización y a qué runbook ir). **Nunca** lleva secretos, códigos, tokens, direcciones de red completas ni cuerpos de solicitudes.
- Telegram **complementa** al correo; no lo sustituye (C11). El orden de aviso y quién recibe cada alerta sigue siendo decisión del dueño.

**SMS por consulta (pull primero).**

- La plataforma consulta periódicamente la API que la persona definió, con el mismo patrón del sondeo IMAP (ejecución puntual por cron, arrendamiento, retroceso exponencial, rol de base de datos propio). No se abre ningún endpoint público nuevo.
- La configuración es **declarativa**: URL base HTTPS, método (`GET` o `POST`), un encabezado de autenticación (nombre y valor secreto), parámetros fijos y una **asignación por rutas** a un documento JSON (lista de mensajes, remitente, texto, fecha, identificador). Sin código del usuario y **sin expresiones regulares del usuario** (ya prohibidas en ADR 0045); la extracción del código sigue el pipeline estricto de ADR 0045.
- El SMS conserva las reglas de ADR 0045 §8: el remitente es falsificable, el filtro es comodidad y no garantía, y todo SMS sin plantilla `login_code` explícita se trata como sensible.

**Cliente HTTP saliente (nuevo, ruta protegida).** Una sola implementación compartida que:

- Solo acepta `https`; puerto 443 salvo lista de puertos permitida y explícita.
- Resuelve con `NetworkGuard`, conecta a la IP devuelta y conserva el nombre para TLS.
- **No sigue redirecciones.** Tiempo máximo corto y tope de tamaño de respuesta.
- Rechaza encabezados que la persona no puede fijar (por ejemplo `Host` y cualquier encabezado de enrutamiento).
- Nunca registra el valor de los encabezados ni el cuerpo de la respuesta; registra solo el código de error estable.
- Al guardar la configuración se valida la URL y se rechaza si el nombre resuelve a un rango no permitido; se vuelve a validar en **cada** consulta (no basta validar una vez).

**Auditoría.** Acciones nuevas (`integration.created`, `integration.updated`, `integration.secret_rotated`, `integration.archived`, `integration.test_sent`) en la misma transacción, con lista permitida de metadatos que **nunca** incluye secretos ni URL completa. Las negaciones también se auditan.

**Interfaz.** Sección de integraciones solo visible con el permiso correspondiente (la guarda real está en el servidor), con componentes y tabla estándar del sistema de diseño y textos en es-MX y en-US. El token no se vuelve a mostrar tras guardarse.

## Alternativas consideradas

- **Webhook (push) del proveedor de SMS en lugar de consulta.** Se difiere: exige un endpoint público, verificación de firma por proveedor y defensa contra repetición (amenazas T3 y T4 de ADR 0045). Es compatible con "cualquier API" solo si el proveedor firma de una forma conocida, y no es genérico. Queda como fase posterior detrás del mismo puerto. _(Confianza media en que pull sea la mejor primera opción.)_
- **Permitir URL libre también para Telegram.** Descartada: amplía la superficie SSRF sin ganancia; el host de Telegram es fijo.
- **Transformación con expresiones o código del usuario.** Descartada: ejecución de código ajeno y riesgo de ReDoS; la asignación por rutas cubre los casos comunes.
- **Guardar la llave de API en variables de entorno.** Descartada: la persona administradora debe poder configurarla sin acceso al despliegue, y los secretos por organización van cifrados con la DEK de esa organización.
- **Un único permiso para ambas integraciones.** _(Inferida del plan.)_ Descartada: Telegram expone el estado operativo de toda la plataforma y debe quedar en la Raíz; el SMS lo opera el Administrador.

## Consecuencias

- **Positivas**: sin proveedor fijado; el cliente HTTP saliente queda como una sola pieza revisada; las alertas dejan de depender solo del correo.
- **Negativas o costos**: un cliente HTTP y un módulo nuevos en rutas protegidas; el pull añade latencia (el intervalo del cron) frente a un webhook; una API de proveedor con paginación o autenticación no estándar (firmas por solicitud, OAuth) no cabe en el modelo declarativo.
- **Costos que se aceptan**: una alerta de Telegram sale de la plataforma hacia un tercero; el contenido está acotado por la lista cerrada de campos.
- **Verificación**: pruebas de la matriz de autorización (Raíz sí, Administrador no en Telegram); pruebas de aislamiento entre organizaciones; pruebas del cliente contra destinos privados, redirecciones, DNS que cambia, respuestas gigantes y tiempo agotado; prueba de que ningún log ni auditoría contiene el secreto; prueba de que el recifrador cubre la tabla nueva; prueba de paridad de i18n. Revisión adversarial con dos jueces ciegos, mutación a propósito y **hoja de revisión humana firmada**.

## Decisiones del dueño (2026-11-03)

- Dos tipos de notificación (infraestructura para la Raíz, seguridad para el Administrador) con apartados de configuración separados; el segundo se puede abrir a otras personas.
- SMS: **solo consulta (pull)**.
- Proveedor de SMS: genérico y poco conocido (**Wotbi**); se quiere un modelo configurable que sirva con cualquier API. No se verificó la API de Wotbi; el modelo se prueba con ejemplos de respuesta reales antes de cerrar IC-7.
- Revisión humana: se registra con el usuario de git de quien la haga, no con un nombre propio de ninguna persona en las auditorías del proyecto.

- Detalle de los avisos de seguridad: **con el nombre de la cuenta o credencial, censurado**. Nunca se envía una contraseña, un secreto, un código ni un usuario completo. Ejemplo dado por el dueño: `admin.admin@correo.com` se muestra `a***.a***@c***.com`.

### Regla de censura (derivada del ejemplo del dueño)

- Cada tramo de letras o dígitos conserva **solo su primer carácter** seguido de `***` fijo; los separadores (`.`, `@`, `-`, `_`) se conservan.
- El último tramo después del último punto de un dominio (la terminación, como `com`) se conserva.
- Los tres asteriscos son fijos: no revelan la longitud real.
- Se aplica a usuarios, correos y nombres de cuenta o credencial. No se envía ningún valor de secreto, aunque estuviera censurado.
- Una sola función compartida hace la censura, con pruebas de casos límite (cadena vacía, un solo carácter, sin separadores, caracteres no latinos).

## Preguntas abiertas

1. Falta un ejemplo real de la API de Wotbi (una petición y su respuesta) para validar el modelo declarativo antes de cerrar el SMS.

## Notas de uso

- Este ADR es una propuesta: ninguna línea de código se escribe hasta que pase a Aceptada.
- No modifica el ADR 0045; el puerto `SmsProviderPort` se mantiene y este ADR aporta un adaptador real por consulta.
