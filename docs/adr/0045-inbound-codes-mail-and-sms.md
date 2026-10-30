# ADR 0045: Lectura de códigos entrantes por correo y SMS, compartida por vistas filtradas

- **Estado**: Propuesta. Borrador de Ingeniería por **encargo del dueño (2026-10-30)**, que adelanta antes de la prueba de intrusión la lectura de códigos por correo (fase 4 del plan) y por SMS (fase 5). Todo lo que aquí no viene del encargo es **propuesta mía** y está marcado así. No es una decisión hasta que una persona la ratifique. Revisado por dos jueces ciegos el 2026-10-30 (ver "Revisión por jueces 2026-10-30").
- **Fecha**: 2026-10-30
- **Referencias**: [`plan.md`](../../plan.md) "Preparación para lectura de correos y SMS" (líneas 773 a 801); [ADR 0004](0004-server-side-encryption-kms-per-org-dek.md) (AAD); [ADR 0015](0015-mandatory-mfa-passkeys-preferred.md) (sin SMS ni correo como segundo factor del sistema); [ADR 0021](0021-pre-authentication-access-with-rls.md); [ADR 0035](0035-transactional-outbox-for-events.md); [ADR 0038](0038-purge-expired-ephemeral-rows.md); [ADR 0036](0036-effective-access-computed-on-the-fly.md); [ADR 0039](0039-single-instance-until-redis.md); [`docs/database.md`](../database.md) líneas 656 y 680 a 682 (tablas y función previstas); migraciones `0005_vault.sql` (`shares`, trigger `shares_check_refs`) y `0021_credential_restore_version_permission.sql` (molde de permisos); `odd/tasks/inbound-codes.md`; `TODO.md` filas T y S2.

## Resumen

**Propuesta (confianza media, alrededor de 70 %):** recibir el correo por un **alias propio bajo un subdominio dedicado** con recepción programable (camino A del plan, sin IMAP ni contraseñas de buzones), exigir **DKIM válido y alineado de forma estricta** antes de aplicar cualquier plantilla, y compartir **vistas filtradas** reutilizando los niveles de `shares` (USE, VIEW, EDIT, MANAGE). La clasificación **falla cerrada**: solo una plantilla explícita de `login_code`, mantenida en el catálogo de plataforma, produce algo visible con USE; todo lo demás es sensible o va a cuarentena. Se guarda solo el código extraído, cifrado y con vigencia de 10 minutos; **se prefiere no persistir el cuerpo en absoluto**. El SMS usa el mismo canal interno detrás de `SmsProviderPort` con adaptador falso. **Esta propuesta no introduce ningún adaptador real**: subdominio, vía de recepción (y dónde corre la verificación DKIM), proveedor de SMS y retención legal siguen abiertos.

## Contexto

El plan ya fija el camino de correo (líneas 784 a 794): recepción programable, verificación DKIM alineada, asociación por alias, extracción por reglas (`mail_rules`, línea 789), almacenamiento mínimo con vigencia de 10 minutos, entrega a quien tenga USE (línea 791) y worker aislado. Lo deja para la fase 4, después de la prueba de intrusión. El dueño decidió adelantarlo y fijó el modelo: un **buzón** con **filtros** y una **vista filtrada** que se comparte con personas y grupos.

Hechos verificados en el repositorio:

- Ya existe `accounts.recovery_email_alias` (único global) y `platforms.mail_rules` (vacío en la fase 1). `docs/database.md` línea 656 anticipa `mailboxes`, `mail_aliases`, `inbound_messages` y `extracted_codes`; la línea 680 anticipa `auth.resolve_mail_alias(address)` y un rol de worker propio. Son nombres del diseño previo, punto de partida y no esquema cerrado.
- `shares.resource_type` hoy solo admite `account` (check en `0005_vault.sql`) y el trigger `shares_check_refs` solo valida la existencia y la organización del recurso cuando el tipo es `account` (0005, líneas 188 y 213 a 216): un tipo nuevo pasaría **sin validación** si no se redefine el trigger. La vista `effective_access` es genérica en el tipo de recurso.
- `ManageShares` (`manage-shares.ts`, líneas 62 a 243) está atado a cuentas: busca la cuenta, exige `share.manage` y el nivel MANAGE sobre ella y crea tareas de rotación. No sirve para vistas tal cual.
- El cifrador **ya es genérico**: `SecretContext` en `secret-context.ts` (líneas 7 a 21) es `organizationId | resourceId | field | version`; `resourceId` es una cadena libre.
- `SYSTEM_ROLES` (`system-roles.ts`) **se calcula por techo de rango**: Líder recibe todo permiso con techo mayor o igual a 2 y Operador todo con techo 3 (salvo una lista de exclusión explícita, como `credential.reveal_password`). Un permiso nuevo llega solo a esos roles según su techo.
- El outbox es al menos una vez, con sondeo, y su trabajador corre **dentro de la API** (ADR 0035, punto 4); `main.worker.ts` sigue pendiente. `purge-expired` recorre organizaciones con `TenantScope.runAs` y actor nulo (ADR 0038), con una gracia de 1 hora sobre lo vencido.
- La resolución de organización antes del contexto con aislamiento por filas usa funciones `SECURITY DEFINER` mínimas (ADR 0021).

## Decisión (propuesta)

### 1. Modelo

| Concepto | Qué es | Notas |
| --- | --- | --- |
| Fuente (buzón) | Una dirección de correo o un número de SMS de la organización | Lleva el canal (`mail` o `sms`). Puede ligarse a una cuenta de la bóveda; no es obligatorio |
| Plantilla | Regla del **catálogo de plataforma**: remitente, asunto, extracción y **tipo** (`login_code`, `reset_code`, `reset_link`) | La mantiene quien tiene `platform.manage` (techo 1; `platforms.mail_rules`, plan línea 789). Una fuente solo **referencia** plantillas; no las define |
| Vista | Un conjunto con nombre de referencias a plantillas de **una** fuente | Es lo que se comparte para leer. Sin vistas, nada se comparte |
| Mensaje entrante | Lo recibido, solo mientras se procesa (o nunca persistido, ver sección 3) | |
| Elemento extraído | El código o enlace cifrado, con vencimiento y tipo | Un mensaje produce un elemento; no se copia por vista |
| Recepción (historial) | Metadatos mínimos de cada mensaje aceptado o rechazado | Sirve a VIEW y a la deduplicación (sección 3) |
| Cuarentena | Lo que no casa con una plantilla o falla la verificación | Solo metadatos; **pertenece a la fuente**, no a una vista |

**Clasificación, falla cerrada.** La sensibilidad no la decide un filtro editable por quien tiene EDIT. Un mensaje se trata como **sensible** (o se envía a cuarentena sin extraer nada) salvo que case con una plantilla explícita de tipo `login_code`. Una plantilla `reset_code` o `reset_link` produce un elemento sensible; un mensaje sin plantilla no produce elemento. Cambiar el tipo de una plantilla es una acción de plataforma (`platform.manage`, con reautenticación y evento crítico, como ya define `ACTION_POLICY`), nunca de `inbound.configure`.

### 2. Correo: camino A, sin credenciales de buzones

1. Subdominio dedicado y alias por cuenta, como ya fija el plan. **El nombre del subdominio y el DNS siguen abiertos** (decisión nº 4, `TODO.md` C10). El subdominio de alias se **reserva**: ninguna dirección de usuario (invitaciones, `users.email`) puede pertenecer a él.
2. Recepción programable. **Vía abierta**: SES entrante o SMTP propio. El contrato interno es un puerto de recepción cuyo resultado de autenticación del correo es **abstracto** (ver punto 3).
3. **Compuerta DKIM sobre un resultado estructurado.** El dominio puro **no** verifica criptografía: recibe un resultado con la firma que validó, `d=`, la lista `h=` con el conteo de instancias de cada cabecera, si hay `l=`, `t=` y `x=`, el tipo y el tamaño de la clave, y las cabeceras `From`, `To`, `Subject` y `Date` ya extraídas. El correo se **rechaza a cuarentena** si ocurre cualquiera de:
   - la firma que validó trae `l=` (permite añadir contenido sin invalidarla);
   - `From` o `Subject` no están **sobrefirmados** en `h=` (un conteo menor al de instancias presentes), o hay más de un `From` o más de un `Subject`;
   - `Date` o `To` no están firmados;
   - el destinatario de la cabecera `To` no es el alias de la fuente que recibió el mensaje (un correo firmado para otro destinatario no se reutiliza);
   - la clave es débil (propuesta: menos de 2048 bits; **por medir** con correos reales, porque algunas plataformas firman con 1024);
   - `x=` ya venció, o `t=` está en el futuro más allá de la tolerancia;
   - el dominio `d=` no está alineado con el dominio del `From`.
   **Alineación estricta por defecto** (`d=` igual al dominio del `From`). La relajada exige una lista de sufijos públicos, que es una **dependencia nueva y requiere aprobación**: se documenta como excepción y no se asume.
4. **Dónde corre la verificación es una decisión abierta y prerrequisito de IC-3.** Con el veredicto de un proveedor (SES) no se sabe qué firma pasó ni la alineación, y no se pueden comprobar `l=`, `h=` ni la clave: habría que confiar en un veredicto que no cubre estas reglas. Con SMTP propio, o con SES entregando el correo crudo a un verificador propio, el puerto recibe el resultado estructurado. IC-1 trabaja sobre el puerto con resultados abstractos y no depende de esa decisión.
5. Un filtro de asunto o de extracción **no sustituye** la compuerta: los dos se aplican.

### 3. Qué se guarda y cómo se procesa

**Preferencia: no persistir el cuerpo.** Con SES entrante hacia S3 el evento lleva solo la clave del objeto; el worker lo lee, extrae y descarta en memoria. El objeto en S3 vive horas por ciclo de vida del proveedor (requisito de la decisión de recepción, no un detalle). El evento del outbox lleva la clave opaca, nunca el cuerpo (el outbox se conserva 7 días, ADR 0035 adenda).

**Alternativa si el proveedor empuja el cuerpo por webhook:** se guarda **cifrado con la DEK de la organización** y se **purga por una tarea de minutos** (no con la gracia de 1 hora del ADR 0038, que es otra cosa). Se **reconoce** que el texto cifrado pasa por el WAL y los respaldos de la base de datos y no se puede anular allí: anular o borrar la fila no borra esas copias. Por eso es la alternativa, no la preferencia.

- **Elemento extraído**: cifrado con el módulo de criptografía y vencimiento de **10 minutos** (plan, línea 790). Al leer se ignora lo vencido aunque la purga no haya corrido.
- **Evento fallido en cuarentena de outbox** (ADR 0035) que apunta a un mensaje ya purgado o a un objeto ya borrado: el manejador es **no reintentable** para ese caso (marca el evento como terminal y no vuelve a leer).
- **Historial de recepciones (lo que ve VIEW)**: tabla de metadatos mínimos, sin asunto ni valores (fuente, momento, dominio firmante verificado, tipo de plantilla coincidente o motivo de rechazo). Retención propuesta de 30 días. La **deduplicación** vive en la misma tabla con restricción única por organización, fuente e identificador de mensaje del proveedor; su retención (propuesta: 30 días) es **mayor que la tolerancia del webhook y que cualquier ventana de reintento del proveedor**.
- **Cuarentena**: los mismos metadatos, sin asunto ni cuerpo; retención propuesta de 7 días para el contenido de diagnóstico adicional. Guardar el cuerpo para depurar reglas queda **desaconsejado** y, si el dueño lo pide, con tope de 24 horas.
- **Enlaces de restablecimiento**: secreto portador. Se extraen solo si el anfitrión está en una lista permitida de la plantilla, se cifran igual que un código y vencen igual. No se registran en logs ni en auditoría.
- **SMS**: el cuerpo **es** el código. No hay cuerpo aparte que retener ni anular: se extrae y se guarda como elemento cifrado con su vencimiento.

### 4. Permisos, niveles y matriz (propuesta; ruta protegida, migración tipo 0021)

Permisos nuevos:

| Permiso | Para qué | Techo propuesto | Política de acción |
| --- | --- | --- | --- |
| `inbound.read_codes` | Ver códigos `login_code` y el historial | 3 | ninguna |
| `inbound.configure` | Crear fuentes y vistas y editar sus referencias a plantillas | 2 | ninguna |
| `inbound.reveal_reset` | Ver **restablecimientos de código y de enlace** (un solo permiso para ambos) | **1** | reautenticación, motivo escrito y evento crítico (molde `credential.export_totp`, `permission-catalog.ts` líneas 69 y 70) |

El permiso de restablecimiento se concede solo a Raíz y Administrador. Como `SYSTEM_ROLES` se **calcula por techo** (`withCeilingAtLeast`), con techo 1 ningún rol de Líder ni de Operador lo recibe y no hace falta exclusión alguna. Si el dueño prefiere un techo de 2 (para permitir roles personalizados de Líder), hace falta una **exclusión explícita** en las plantillas de Líder y Operador (molde `OPERATOR_EXCLUDED_PERMISSIONS`); sin ella el código concedería el permiso a Líder y diverge de lo que conceda la migración (`system-roles.ts`, líneas 18 y 19, 44 y 45). Compartir una vista reutiliza `share.manage` (ya existe, techo 3); no hay permiso nuevo para compartir.

**Matriz permiso × nivel** (los dos deben cumplirse; sin el nivel responde `NOT_FOUND`, sin el permiso se niega y se audita):

| Acción | Permiso | Nivel mínimo sobre | Notas |
| --- | --- | --- | --- |
| Ver códigos `login_code` vigentes | `inbound.read_codes` | USE (vista) | Nunca restablecimientos |
| Ver historial de recepciones sin valores | `inbound.read_codes` | VIEW (vista) | Solo de lo que casó con la vista |
| Configurar vista (referencias a plantillas) | `inbound.configure` | EDIT (vista) | No define remitentes ni tipos |
| Ver la cuarentena y configurar la fuente | `inbound.configure` | EDIT (fuente) | La cuarentena es de la fuente, no de la vista |
| Archivar fuente o vista | `inbound.configure` | MANAGE | |
| Compartir y revocar una vista | `share.manage` | MANAGE (vista) | Caso de uso nuevo, no `ManageShares` |
| Ver un restablecimiento (código o enlace) | `inbound.reveal_reset` | MANAGE (vista) | Reautenticación, motivo, evento crítico |
| Crear o cambiar plantillas y tipos | `platform.manage` | no aplica | Catálogo de plataforma |

Para que la cuarentena y la configuración sean de la fuente, la propuesta incluye un **segundo tipo de recurso** compartible, `mail_source` (niveles EDIT y MANAGE), junto con `mail_view` (USE a MANAGE). Esto **se aparta del encargo** (que solo habla de compartir la vista) y lo ratifica el dueño. Quien crea una fuente o una vista recibe MANAGE sobre ella (propuesta; no verificado cómo lo hace hoy la creación de cuentas). Si un mensaje casa con varias vistas de la misma fuente, **hay un solo elemento por mensaje**: cada vista lista los elementos cuyas plantillas referencia, y si alguna plantilla coincidente es sensible el elemento es sensible. La cuarentena pertenece a la fuente.

**Migración de `shares` para los tipos nuevos:** debe ampliar el check de `resource_type` y **redefinir `shares_check_refs`** para validar existencia y organización de `mail_view` y `mail_source` (sin esto el trigger no valida nada para esos tipos). Hace falta un **caso de uso nuevo** para compartir vistas y fuentes (el existente está atado a cuentas).

Resto de la migración (número libre: hoy el siguiente es el 0023): redefinir `permission_rank_ceiling()` con las líneas nuevas (si no, el trigger de la 0015 rechaza cualquier rol con el permiso, falla cerrado); no conceder a roles personalizados lo que no corresponda; subir `SYSTEM_ROLES_VERSION`; mantener la prueba de sincronía SQL y código contra la última migración que redefina la función. Como `SYSTEM_ROLES` concede por techo, cualquier concesión **más estrecha** que el techo exige exclusión explícita en el código además de la migración.

**Desvío del plan, declarado.** El plan (línea 791) y `docs/database.md` (líneas 680 a 682) entregan el código "a quien tenga USE" **sobre la cuenta**. Esta propuesta lo cambia: **la ACL de la vista decide**, no la de la cuenta. Consecuencias propuestas: (a) al **archivar** la cuenta ligada, la fuente se suspende (no recibe ni entrega) y las comparticiones de la vista quedan inertes, sin revocarse; (b) **revocar a alguien de la cuenta no corta** su acceso a la vista, y tampoco al revés; hay que revocar en ambos lugares, y el listado de accesos de la cuenta debe mostrar las vistas ligadas; (c) compartir una vista de una fuente ligada exige que quien comparte tenga al menos USE sobre la cuenta (no se concede más de lo propio, ADR 0012). Alternativa más estricta: exigir USE en la cuenta **y** nivel en la vista al leer; sigue el plan pero acopla dos ACL. **Lo decide el dueño.** Reconciliación con `recovery_email_alias`: la dirección de una fuente ligada a una cuenta **es** ese alias (ya único global); no se crea una columna paralela. `docs/database.md` línea 680 previó `mail_aliases` como reemplazo: IC-2b decide si basta con la columna existente o si se migra, y esa decisión actualiza `database.md`.

### 5. Revocación, rotación y qué se audita como lectura

- **Revocar corta el acceso de inmediato**: es una decisión sobre `effective_access`, no una copia.
- **Rotación**: el enlace o el código externo de un restablecimiento suele seguir vigente **horas** después de que venció el elemento extraído. Al revocar a quien **vio** un restablecimiento (se sabe por la auditoría de revelaciones), se crea una **tarea de rotación** para la cuenta ligada, como hace `ManageShares`. Para códigos `login_code` no hay tarea: vencen en minutos.
- **Unidad auditada de la lectura de un código**: **una vez por (persona, elemento extraído)**, en la primera entrega. Los refrescos y los reenvíos por SSE del mismo elemento no escriben otra entrada. Un restablecimiento se audita **cada vez que se revela** a petición explícita, con motivo, y nunca se empuja por SSE.

### 6. Recepción por webhook y resolución previa a la organización

- **El ADR 0021 no alcanza tal cual**: aquí quien llama es un tercero y la organización se deduce de la dirección de destino. Se necesita `auth.resolve_inbound_address(address)` con el molde de la 0008 (dueño sin `BYPASSRLS`, `search_path` fijo, `EXECUTE` solo a `iam_app`, sin búsquedas parciales ni listados) que devuelva organización, fuente, canal y estado. Es una excepción de aislamiento nueva con revisión de dos revisores. La dirección es dato del atacante: respuesta idéntica y **tiempo comparable** para inexistente, archivada y sin firma válida.
- **Orden**: (1) límite global de la ruta y por IP, y tope de tamaño; (2) **verificar la firma del proveedor antes de consultar la base de datos** siempre que el proveedor lo permita (SNS y SES firman con un certificado asimétrico público del proveedor, sin secreto por organización); (3) solo entonces resolver la fuente y abrir el contexto de la organización; (4) para proveedores con HMAC por fuente, resolver y descifrar el secreto y verificar; (5) aceptar. Para un alias inexistente se ejecuta el **mismo trabajo** (incluida una verificación contra un secreto señuelo) para igualar el tiempo. Un fallo en cualquier paso responde igual.
- **Cubos de límite aparte** para el tráfico de alias inexistentes o con firma inválida, con un **tope global de la ruta**, de modo que no agoten el cupo del tráfico legítimo (en memoria hasta que haya Redis, ADR 0039).
- **Secreto por fuente solo para proveedores HMAC.** Con certificado del proveedor (SNS, SES) no hay secreto por organización que cifrar. Cuando sí lo hay, se guarda cifrado por el módulo de criptografía con el identificador de la fuente en `resourceId` y un `field` nuevo (por ejemplo `inbound_signing_secret`). **No es un cambio de formato**: `SecretContext` ya es genérico; basta el identificador de la fuente y un campo nuevo, y la revisión humana de la ruta protegida. Un secreto único de plataforma no tendría DEK de organización que lo proteja (mismo problema del ADR 0044).
- **Repetición (replay)**: la firma cubre una marca de tiempo; se rechaza fuera de una tolerancia (propuesta: 5 minutos) y se deduplica con la restricción única del historial (sección 3). Además se exige que la fecha firmada del mensaje esté dentro de la vigencia del código.

### 7. Procesamiento: sin regex de usuario y worker propio

- **No hay regex de usuario.** Las plantillas se escriben con operaciones **sin retroceso**: igualdad o prefijo de asunto y extracción por patrón de **largo fijo** (por ejemplo N dígitos entre dos literales). Si algún caso exigiera una regex, solo **RE2** (dependencia nueva: requiere aprobación) y con tope de longitud de la entrada.
- **El "worker aislado" hoy no existe.** El trabajador del outbox corre dentro de la API (ADR 0035) y `main.worker.ts` está pendiente; `database.md` línea 680 prevé un rol propio. Es **prerrequisito explícito de IC-3**: un proceso propio y un rol de base de datos propio con sus políticas y `grant` mínimos sobre estas tablas, sin red de salida salvo lo necesario para leer del proveedor.
- El parseo MIME corre bajo **límites duros** de tamaño, profundidad y tiempo. El HTML nunca se renderiza y se ignoran los adjuntos. La **dependencia del parser MIME está pendiente de aprobación** (no se agrega ninguna en esta propuesta).
- Procesa por el outbox (al menos una vez): manejador **idempotente** por la restricción única del historial.

### 8. SMS

- `SmsProviderPort` en la capa de aplicación, con adaptador **falso** para pruebas; el real **no se elige aquí**. El pipeline posterior es el mismo (canal `sms`, plantilla, elemento cifrado, misma compartición).
- **No hay equivalente a DKIM.** El remitente de un SMS es falsificable. El filtro por remitente es una **comodidad, no una garantía**; la interfaz debe decirlo y la extracción debe ser estricta. Todo SMS sin plantilla `login_code` explícita se trata como sensible, igual que el correo. Vigencia igual o menor que la del correo.
- **Dentro del sistema, el SMS no es un factor** (ADR 0015). Sirve para plataformas externas sin otra opción; se mantiene la recomendación de preferir TOTP.

### 9. Auditoría (ruta protegida)

Acciones nuevas en la lista blanca de `audit-actions.ts` (nombres propuestos): alta, cambio y archivo de fuente y de vista; compartir y revocar; **lectura de un código** (unidad definida en la sección 5) y **revelación de un restablecimiento** (evento crítico, aviso a la Raíz). Las negaciones también se auditan.

**No se audita cada mensaje recibido ni cada rechazo en la cadena.** Quien envía es un tercero sin autenticar: dejarlo escribir en la cadena permitiría inflarla y contender por su bloqueo (ADR 0023). Los rechazos van a contadores y al historial sin contenido.

### 10. Purga

`purge-expired` (ADR 0038) se amplía **por adenda cuando se implemente**: elementos vencidos, cuarentena y historial vencidos y, solo en la alternativa de webhook con cuerpo, una tarea propia **de minutos** para los mensajes sin procesar. Mismo molde: por organización con `TenantScope.runAs`, lotes, sin descifrar, sin auditoría de mantenimiento.

## Alternativas consideradas

- **Camino B: leer buzones existentes por IMAP, Gmail API o Microsoft Graph. DESCARTADO por ahora.** Exige guardar **credenciales de correo reales** de buzones de personas o de la empresa: una filtración de la bóveda sería una filtración de buzones completos. Google y Microsoft piden evaluaciones de seguridad para esos alcances. Contradice el mínimo dato del plan y la regla de no cargar credenciales reales antes de la prueba de intrusión. Se reabre solo con decisión expresa del dueño.
- **Compartir el buzón completo**: descartada. La vista filtrada es el límite de lo expuesto.
- **Filtro de remitente sin DKIM, o sin las reglas estrictas de la sección 2**: descartada; el remitente es falsificable.
- **Dejar que EDIT decida el tipo de un filtro**: descartada; EDIT podría reclasificar un restablecimiento como código de inicio de sesión y exponerlo a USE.
- **Regex escrita por el usuario**: descartada (ReDoS en un proceso que recibe datos de terceros).
- **Guardar el cuerpo cifrado de forma estándar**: _(inferida)_ retiene más datos de los necesarios y deja copias en WAL y respaldos.
- **Procesar en la petición del webhook sin outbox**: _(inferida)_ ata la respuesta al procesamiento no confiable y no reintenta. El encargo pide worker aislado con outbox (para SMS, donde el cuerpo es el código, puede evaluarse).
- **Autenticar el webhook por IP del proveedor**: _(inferida)_ rangos cambiantes y sin integridad; la firma es el control.

## Consecuencias (si se acepta)

- **Positivas**: la bóveda no guarda credenciales de correo; quien recibe una compartición ve solo códigos de inicio de sesión explícitos; los restablecimientos exigen MANAGE, reautenticación y motivo; revocar corta de inmediato; lo que se persiste vive 10 minutos.
- **Negativas o costos**: una excepción nueva de aislamiento previa a la autenticación; dos tipos de recurso nuevos en las comparticiones y un trigger redefinido; un proceso y un rol de worker nuevos; superficie de entrada con datos no confiables **antes** de la prueba de intrusión (recomendación mía: hasta esa prueba, solo alias y números de prueba; que la prueba incluya este alcance); un desvío del plan sobre qué ACL decide.
- **Verificación**: pruebas de dominio (compuerta DKIM con cada rechazo de la sección 2, clasificación fail-closed, extracción), de aislamiento, de la matriz permiso × nivel completa, de firma y repetición del webhook, del tiempo uniforme para alias inexistentes, de que ningún cuerpo persiste (o se purga en minutos) y mutación deliberada de la compuerta DKIM, de la clasificación y de la verificación de firma. Las pruebas de autorización, criptografía y aislamiento las escribe o revisa una persona. Ruta protegida: encargo dado; **por rebanada**, dos jueces ciegos sobre un alcance congelado y mutación.

## Amenazas y riesgos

| # | Amenaza | Mitigación propuesta |
| --- | --- | --- |
| T1 | Remitente falsificado con un "código" falso | Compuerta DKIM estricta sobre resultado estructurado (sección 2); si falla, cuarentena |
| T2 | Repetición de un correo legítimo firmado | `x=`/`t=`, fecha firmada dentro de la vigencia, deduplicación, TTL de 10 minutos |
| T3 | Repetición del webhook | Firma con marca de tiempo, tolerancia, restricción única de larga retención, manejador idempotente |
| T4 | Webhook falso | Firma del proveedor verificada antes de la base de datos; certificado del proveedor o secreto cifrado por fuente (HMAC) |
| T5 | Enumeración de alias o números | Función de resolución sin listados; respuesta y tiempo iguales; cubo de límite aparte y tope global |
| T6 | **Escalada de USE a toma de la cuenta** por un restablecimiento | Clasificación **fail-closed** con plantillas del catálogo de plataforma; solo `login_code` explícito es visible con USE; restablecimientos (código y enlace) exigen `inbound.reveal_reset` (techo 1) más MANAGE, reautenticación, motivo y evento crítico; revocar a quien lo vio crea tarea de rotación |
| T7 | Contenido del atacante dentro de un correo legítimo | Extracción por plantilla de largo fijo; enlaces solo de anfitriones permitidos |
| T8 | Correo o SMS masivo, spam, costo | Límites por fuente y por IP, tope de tamaño y de tiempo, tope de cuarentena |
| T9 | Cuerpo persistido en el outbox, en el proveedor, en WAL o respaldos | Preferencia de no persistirlo; evento con clave opaca; ciclo de vida del proveedor; en la alternativa, cifrado y purga de minutos, con WAL reconocido |
| T10 | Números VoIP rechazados por plataformas | Riesgo funcional: validar con la plataforma antes de invertir (plan, línea 799) |
| T11 | SMS como factor débil | Solo para plataformas sin otra opción; nunca factor del sistema (ADR 0015) |
| T12 | Remitente de SMS falsificable | Declararlo en la interfaz; extracción estricta; todo sin plantilla explícita es sensible |
| T13 | Código mostrado a quien no debe | Solo en el estado local del componente, vencimiento visible, `no-store`, sin registrar |
| T14 | HTML, adjuntos o MIME malicioso | Sin renderizar, adjuntos ignorados, límites duros, worker en proceso y rol propios |
| T15 | ReDoS por patrones de usuario | Sin regex de usuario; igualdad, prefijo y largo fijo; RE2 solo con aprobación |
| T16 | Correo firmado reutilizado con otro destinatario o con contenido añadido (`l=`) | Rechazo por `To` distinto del alias, por `l=` y por cabeceras no sobrefirmadas |
| T17 | Alias suplantado por una dirección de usuario | Subdominio de alias reservado |

## Decisiones abiertas (no se inventan aquí)

1. **Subdominio de alias y DNS** (decisión nº 4, `TODO.md` C10).
2. **Vía de recepción y dónde corre la verificación DKIM** (SES con S3 o SMTP propio). Es **prerrequisito de IC-3**. SES entrante añade AWS a la ruta de los datos; SMTP propio exige verificar DKIM en casa (dependencia nueva, requiere aprobación) y operar un servidor expuesto.
3. **Proveedor de SMS** (formato de firma, secreto por organización, costo, números no VoIP).
4. **Retención legal** (`TODO.md` A10 y C9).
5. **Dependencias nuevas que requieren aprobación**: parser MIME, lista de sufijos públicos (solo si se quiere alineación relajada), RE2 (solo si hiciera falta una regex).
6. **Desvío de ACL** (sección 4): vista decide, o vista y cuenta a la vez; y el segundo tipo de recurso `mail_source`.
7. Techo de `inbound.reveal_reset` (1 recomendado, o 2 con exclusión explícita).
8. Cifras propuestas por mí: 10 minutos (del plan), 5 minutos de tolerancia, 30 días de historial, 7 días de cuarentena, clave de 2048 bits, tope de tamaño.

## Revisión por jueces 2026-10-30

Dos revisores ciegos revisaron el borrador (solo documentación). Hallazgos confirmados contra el código o los documentos citados y cómo se resolvieron:

| # | Hallazgo | Verificación | Resolución |
| --- | --- | --- | --- |
| 1 | La sensibilidad la decidía un filtro editable por EDIT | Cierto en el borrador | Clasificación fail-closed; plantillas en el catálogo de plataforma (`platform.manage`); `inbound.configure` solo referencia (secciones 1 y 4) |
| 2 | Restablecimientos sin política de acción ni permiso único | `ACTION_POLICY` (`permission-catalog.ts`, 62 a 70) confirmado | `inbound.reveal_reset` con reautenticación, motivo y evento crítico |
| 3 | Concesión a roles por techo diverge de la migración | `system-roles.ts` calcula por techo: confirmado | Techo 1 evita la exclusión; con techo 2 se exige exclusión explícita. **Matiz**: el techo 1 por sí solo cumple "solo Raíz y Administrador", así que la exclusión es necesaria solo con techo 2 |
| 4 | Faltaba permiso de compartir y matriz | Cierto | `share.manage` y matriz completa (sección 4) |
| 5 | Desvío de ACL (vista contra USE en la cuenta) sin declarar | Plan línea 791 y `database.md` 680 a 682 confirmados | Declarado, con efectos al archivar y revocar y alternativa más estricta (decisión del dueño) |
| 6 | DKIM sin reglas de cabeceras, `l=`, claves ni alineación estricta | Cierto | Sección 2: resultado estructurado y lista de rechazos; relajada como excepción con dependencia |
| 7 | Con veredicto del proveedor no se verifica nada de eso | Cierto por construcción | Decisión de dónde corre la verificación, prerrequisito de IC-3 |
| 8 | ReDoS por patrones de usuario | Cierto | Sin regex de usuario; RE2 solo con aprobación |
| 9 | "Worker aislado" no existe | ADR 0035 punto 4 y `main.worker.ts` pendiente confirmados | Prerrequisito explícito de IC-3, MIME bajo límites duros, parser pendiente de aprobación |
| 10 | `mail_view` en `shares` sin validar | `0005_vault.sql` 188 y 213 a 216: el trigger solo valida `account`; confirmado | Redefinir `shares_check_refs`; caso de uso nuevo (`ManageShares` está atado a cuentas, confirmado) |
| 11 | Cuerpo cifrado con "anulación" y gracia de 1 hora | Gracia de 1 hora en ADR 0038 confirmada | Preferir no persistir; alternativa con purga de minutos; WAL y respaldos reconocidos; evento fallido no reintentable |
| 12 | Afirmación de "cambio de formato del AAD" | `secret-context.ts` 7 a 21: **ya genérico**; el borrador se equivocaba | Corregido: basta id de fuente y `field` nuevo; secreto por fuente solo para HMAC |
| 13 | Orden del webhook consulta la base antes de verificar | Cierto | Verificar firma primero, tiempo igualado, cubo aparte y tope global, subdominio reservado |
| 14 | Sin rotación tras restablecimientos y auditoría ruidosa | `ManageShares` crea tareas de rotación: confirmado | Tarea de rotación al revocar; unidad de auditoría definida |
| 15 | Rebanadas demasiado gordas | Cierto | IC-2 en 2a, 2b y 2c; IC-3 fusionada con IC-4; IC-5 en 5a, 5b y 5c (ver `odd/tasks/inbound-codes.md`) |

Ningún hallazgo se descartó. El único matiz es el del punto 3. IC-0 (ratificación) queda **cumplida por el dueño** (camino A elegido el 2026-10-30, "adelante con lo necesario"); el ADR **sigue en Propuesta**. Solo **IC-1** está autorizada a empezar; IC-2 en adelante esperan estos cambios y una nueva revisión de los jueces.

## No verificado

- Que SES entrante esté disponible en la región elegida ni su comportamiento con un hospedaje en Linode.
- Que el DKIM de las plataformas del catálogo (por ejemplo `security@facebook.com`) firme `Subject`, sobrefirme las cabeceras, no use `l=`, alinee con el `From` y use claves de 2048 bits; hay que medirlo con correos reales de prueba.
- Cómo se asigna hoy MANAGE al crear una cuenta (se propone lo mismo para fuentes y vistas).
- No se leyó el código del guardia de autorización ni de `effective_access` más allá de `docs/database.md`: la compatibilidad de los tipos nuevos con ellos se infiere.
- No se ejecutó ninguna prueba; este documento no cambia código.
