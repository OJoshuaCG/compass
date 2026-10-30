# Lectura de códigos entrantes por correo y SMS (IC)

Estado: **documentación más la rebanada IC-1 (código y pruebas de dominio, 2026-10-30; sin migraciones y sin pruebas ejecutadas).** Ruta protegida (identidad previa a la autenticación, criptografía, auditoría, permisos y migraciones con aislamiento): el dueño ya dio el encargo humano; faltan nueva revisión de dos jueces ciegos sobre un alcance congelado, mutación a propósito y revisión humana de las pruebas de autorización, criptografía y aislamiento, **por rebanada**.

Diseño: [ADR 0045](../../docs/adr/0045-inbound-codes-mail-and-sms.md) (**Propuesta**). Negocio: `docs/business/vault.md` sección 14 (propuesta). Seguimiento: `TODO.md` épica T y fila S2.

Los identificadores de rebanada son **IC-n** (no R1 a R8) para no chocar con las subtareas R1 y R2 de auditoría en `TODO.md`.

## Especificación (textual del encargo del dueño, 2026-10-30)

- "Adelantar, antes del pentest, la lectura de CÓDIGOS entrantes por correo y SMS."
- Correo, camino A del plan (`plan.md:773-800`): "sin IMAP ni contraseñas de buzones, alias propio por cuenta bajo un subdominio dedicado, recepción programable, verificación DKIM alineada."
- "Alguien con permiso configura un 'buzón' y define FILTROS (remitente exacto, p. ej. security@facebook.com, y/o patrón de asunto); el filtro solo se aplica si el correo pasa DKIM alineado (el remitente es falsificable); lo que no coincide va a cuarentena y no lo ve quien recibe la compartición."
- "Se comparte la VISTA FILTRADA (no el buzón completo) con otros usuarios/grupos reutilizando el modelo de comparticiones de la bóveda (niveles USE/VIEW/EDIT/MANAGE; USE = ver códigos extraídos; configurar buzón/filtros = EDIT/MANAGE y permiso del catálogo) y revocar corta el acceso."
- "Se guarda lo mínimo: código extraído cifrado con el módulo de criptografía y TTL corto (plan: 10 min); el cuerpo completo no se persiste (o solo el tiempo estrictamente necesario, justifícalo). Enlaces de restablecimiento exigen MANAGE y son evento crítico (`plan.md:795`)."
- SMS (fase 5 adelantada): "números de un proveedor con API (proveedor aún NO decidido: define un puerto `SmsProviderPort` y un adaptador falso para pruebas; el real queda como decisión abierta), mismo pipeline, misma compartición por vista filtrada (número + filtro por remitente/patrón)."
- Riesgos a documentar: números VoIP, SMS como factor débil (ADR 0015), spam y abuso, límite de tamaño, replay del webhook, resolución de organización por alias o número antes del contexto con RLS (ADR 0021), autenticación del webhook por firma con secreto cifrado por el módulo de criptografía (campo nuevo en el AAD), worker aislado reutilizando el outbox, purga en ADR 0038, auditoría (acciones nuevas en la lista blanca), permisos nuevos con migración tipo 0021 (techo de rango, roles de sistema, versión).
- Camino B (IMAP, Gmail, Graph): **descartado por ahora** (guardaría credenciales de correo reales).
- Decisiones **abiertas que no se inventan**: subdominio de alias y DNS (nº 4, `TODO.md` C10), SES entrante frente a SMTP propio, proveedor de SMS, retención legal.

## Estado tras la revisión por jueces (2026-10-30)

- **IC-0 cumplida** por el dueño (camino A elegido el 2026-10-30, "adelante con lo necesario"). El ADR 0045 **sigue en Propuesta**.
- **Solo IC-1 está autorizada a empezar.** IC-2 en adelante esperan los cambios del ADR (sección "Revisión por jueces 2026-10-30") y una nueva revisión de los jueces.
- Los prerrequisitos de IC-3 son: decidir la vía de recepción y dónde corre la verificación DKIM, y que exista el worker propio (proceso y rol).

## Decisiones de diseño propuestas (mías, por confirmar)

Resumen; el porqué está en el ADR 0045.

| Tema | Propuesta |
| --- | --- |
| Qué se comparte | La **vista** (`mail_view`); la cuarentena y la configuración son de la **fuente** (`mail_source`, tipo nuevo; se aparta del encargo, lo ratifica el dueño) |
| Clasificación | **Falla cerrada**: solo una plantilla explícita `login_code` es visible con USE. Las plantillas (remitente, asunto, extracción, tipo) viven en el catálogo de plataforma (`platform.manage`, techo 1); `inbound.configure` solo las referencia |
| Permisos | `inbound.read_codes` (techo 3), `inbound.configure` (2), `inbound.reveal_reset` (**1**; un solo permiso para restablecimiento de código y de enlace, con reautenticación, motivo y evento crítico). Compartir usa `share.manage` |
| Matriz | Ver la tabla permiso × nivel del ADR, sección 4 |
| Desvío del plan | La ACL de la vista decide, no USE en la cuenta (plan línea 791); efectos al archivar y revocar la cuenta en el ADR; decide el dueño |
| DKIM | El dominio puro recibe un resultado estructurado; estricta por defecto; relajada requiere lista de sufijos públicos (dependencia, aprobación) |
| Plantillas | Sin regex de usuario: igualdad o prefijo de asunto y extracción de largo fijo |
| Cuerpo | Preferencia: **no persistirlo** (SES a S3, el worker lee y descarta); alternativa: cifrado y purga de minutos, con WAL y respaldos reconocidos. SMS: el cuerpo es el código |
| Auditoría | Configuración, compartir y revocar; lectura de código **una vez por persona y elemento**; revelación de restablecimiento crítica. **No** se audita cada recepción ni rechazo |
| Resolución previa | Función `auth.resolve_inbound_address` nueva; firma verificada **antes** de consultar la base cuando se pueda; tiempo igualado |
| Rotación | Revocar a quien vio un restablecimiento crea tarea de rotación (como `ManageShares`) |

## Rebanadas (pequeñas y ordenadas)

Cada rebanada se entrega con sus pruebas y su documentación, y no depende de una posterior. ⚠ = ruta protegida: **cada rebanada protegida pasa por dos jueces ciegos y mutación deliberada**.

| ID | Rebanada | Depende de | Estado |
| --- | --- | --- | --- |
| IC-0 | Ratificación del encargo y elección del camino A | — | **Cumplida** (dueño, 2026-10-30). El ADR sigue en Propuesta |
| IC-1 | Dominio puro: plantillas y filtros **sin regex de usuario**, compuerta DKIM sobre **resultado estructurado** (puerto con resultados abstractos), extracción de código y de enlace con lista de anfitriones, vigencia, **clasificación fail-closed**. Sin base de datos ni red | IC-0 | **Escrita, sin cerrar** (typecheck y lint en verde; faltan jueces, mutación y revisión humana) |
| IC-2a | Permisos, techo, plantillas de roles y lista blanca de auditoría ⚠ (molde 0021; la siguiente migración libre es la 0023): `inbound.read_codes`, `inbound.configure`, `inbound.reveal_reset` con política de acción, `permission_rank_ceiling()`, `SYSTEM_ROLES_VERSION`, exclusiones si el techo lo exige, acciones nuevas de auditoría | IC-0 | Hecha 2026-10-30 (ver bitácora) |
| IC-2b | Tablas con RLS ⚠: fuentes, vistas, referencias a plantillas, elementos extraídos, historial de recepciones (con deduplicación), cuarentena; `mail_view` y `mail_source` en `shares` con **`shares_check_refs` redefinido**; reconciliación con `recovery_email_alias` | IC-2a | Espera revisión de jueces |
| IC-2c | Función `auth.resolve_inbound_address` y **rol de base de datos del worker** con sus grants ⚠ | IC-2b | Espera revisión de jueces |
| IC-3 | **Recepción y procesamiento (antes IC-3 e IC-4, fusionadas)** ⚠. **Prerrequisitos**: vía de recepción y lugar de la verificación DKIM decididos (verificador como puerto); worker propio existente (proceso `main.worker.ts` y rol de IC-2c); parser MIME aprobado. Incluye: verificador de firma antes de la base de datos, tiempo igualado, cubos de límite y tope global, historial y deduplicación, parseo MIME bajo límites duros, manejador idempotente y no reintentable ante mensaje purgado, elementos cifrados con vencimiento, purga (adenda al ADR 0038 por una persona). **Prohibido persistir el cuerpo** salvo la alternativa documentada (cifrado, purga de minutos) | IC-1, IC-2c y los prerrequisitos | Bloqueada por prerrequisitos |
| IC-5a | Lectura por USE ⚠: casos de uso y endpoint de códigos `login_code`, historial para VIEW, unidad de auditoría de lectura, entradas de la matriz de autorización | IC-2b, IC-3 | Pendiente |
| IC-5b | Configuración ⚠: fuentes, vistas, compartir (caso de uso **nuevo**, no `ManageShares`), revocar y archivar, quién recibe MANAGE al crear, cuenta ligada archivada o revocada | IC-5a | Pendiente |
| IC-5c | Enlaces y códigos de restablecimiento críticos ⚠: `inbound.reveal_reset` con reautenticación, motivo, evento crítico y aviso a la Raíz; tarea de rotación al revocar | IC-5b | Pendiente |
| IC-6 | Web: fuentes y filtros, vistas compartidas, códigos con vencimiento visible. Solo componentes y tokens del sistema de diseño, tabla estándar, es-MX y en-US, accesibilidad. El código vive solo en el estado local del componente | IC-5a | Pendiente |
| IC-7 | SMS: `SmsProviderPort`, adaptador falso, canal `sms` en el mismo pipeline, aviso de remitente no verificado, límites por número | IC-5a | Pendiente |
| IC-8 | Adaptadores reales y operación: recepción de correo, proveedor de SMS, DNS (SPF, DKIM, DMARC), runbook, `docs/threat-model.md`, `docs/database.md` y `docs/backend.md`, alcance de la prueba de intrusión | IC-5c más las decisiones abiertas | **Bloqueada** por decisiones |

## Criterios de aceptación

Propuestos. Las cifras marcadas "propuesta" las confirma el equipo antes de empezar.

**IC-1** (el resultado DKIM llega como estructura abstracta; ninguna prueba hace criptografía)
- [ ] Un resultado con DKIM válido pero `d=` distinto del dominio del `From` (alineación estricta) nunca coincide con una plantilla.
- [ ] Rechazo con `l=` presente.
- [ ] Rechazo si `From` o `Subject` no están sobrefirmados en `h=` (conteo menor al de instancias) o si hay más de un `From` o más de un `Subject`.
- [ ] Rechazo si `Date` o `To` no están firmados.
- [ ] Rechazo si el destinatario de la cabecera `To` no es el alias de la fuente.
- [ ] Rechazo con clave débil (propuesta: menos de 2048 bits) y con `x=` vencido.
- [ ] Un remitente que contiene el exacto como subcadena (prefijo o sufijo de dominio) no coincide.
- [ ] Clasificación fail-closed: un mensaje sin plantilla `login_code` explícita nunca produce un elemento visible con USE; una plantilla `reset_code` o `reset_link` produce un elemento sensible.
- [ ] No existe ninguna ruta que interprete un patrón de usuario como regex; la extracción es de largo fijo y devuelve el código solo si el patrón ancla y el largo coinciden; texto del atacante dentro del mensaje no lo altera.
- [ ] Un enlace con anfitrión fuera de la lista permitida no se extrae.
- [ ] Mutaciones deliberadas, cada una hace fallar alguna prueba: invertir la alineación; quitar el rechazo por `l=`; quitar el rechazo por cabecera no sobrefirmada; cambiar la clasificación por defecto de sensible a `login_code`; ignorar el destinatario.

**IC-2a**
- [ ] El trigger de techo rechaza los permisos nuevos si la función no los conoce, y la prueba de sincronía compara SQL y código contra la última definición.
- [ ] `inbound.reveal_reset` solo lo reciben Raíz y Administrador en la migración **y** en `SYSTEM_ROLES` (con exclusión explícita si el techo fuera 2); una prueba compara ambos.
- [ ] La política de acción de `inbound.reveal_reset` exige reautenticación, motivo y evento crítico.

**IC-2b**
- [ ] Toda tabla nueva lleva organización, índice y política de aislamiento en la misma migración; ninguna migración aplicada se editó.
- [ ] `shares_check_refs` valida existencia y organización de `mail_view` y `mail_source`: una compartición con un recurso de otra organización o inexistente falla.
- [ ] Una organización no ve fuentes, vistas, elementos ni historial de otra.

**IC-2c**
- [ ] `auth.resolve_inbound_address` devuelve solo organización, fuente, canal y estado; igual respuesta para inexistente y archivada; `search_path` fijo; `EXECUTE` solo para `iam_app`; un rol sin permiso no puede alterarla.
- [ ] El rol del worker solo tiene los grants de estas tablas.

**IC-3**
- [ ] Sin firma, con firma inválida, con firma de otra fuente o fuera de tolerancia (propuesta: 5 minutos): misma respuesta y nada persistido.
- [ ] La firma se verifica antes de cualquier consulta a la base de datos cuando el proveedor lo permite; un alias inexistente tarda un tiempo comparable al de uno válido.
- [ ] El tráfico de alias inexistentes usa un cubo de límite aparte y el tope global de la ruta se respeta.
- [ ] El mismo mensaje del proveedor enviado dos veces genera un solo registro; la deduplicación se conserva más que la tolerancia.
- [ ] Un cuerpo por encima del tope (propuesta: 256 KB) se rechaza antes de procesarlo; el parseo MIME respeta los límites de tamaño, profundidad y tiempo.
- [ ] El cuerpo no queda en la base de datos ni en el outbox (o, en la alternativa, se purga en minutos); el elemento extraído vencido no se devuelve aunque no se haya purgado.
- [ ] Un evento fallido que apunta a un mensaje ya purgado no se reintenta.
- [ ] Reprocesar el mismo evento no duplica elementos. El secreto de firma (si lo hay) se guarda cifrado con el id de la fuente y un `field` nuevo; no aparece en logs.
- [ ] Mutaciones: omitir la verificación de firma; mover la verificación después de la consulta; quitar la deduplicación.

**IC-5a**
- [ ] Matriz permiso × nivel completa del ADR: cada fila con prueba de permitido y de negado; sin nivel responde `NOT_FOUND`; toda negación se audita.
- [ ] La lectura de un código escribe una auditoría por (persona, elemento); un refresco o un reenvío por SSE no escribe otra.
- [ ] Quien recibe una vista nunca ve restablecimientos ni cuarentena.

**IC-5b**
- [ ] Revocar corta el acceso de inmediato, incluso con una compartición por grupo y otra directa (vale el nivel más alto de lo que queda).
- [ ] No se comparte más de lo propio (ADR 0012); compartir una vista de una fuente ligada exige al menos USE en la cuenta.
- [ ] Archivar la cuenta ligada suspende la fuente; las comparticiones de la vista quedan inertes.
- [ ] Un mensaje que casa con varias vistas produce un solo elemento; si alguna plantilla coincidente es sensible, el elemento es sensible.

**IC-5c**
- [ ] Ver un restablecimiento (código o enlace) exige `inbound.reveal_reset` y MANAGE, reautenticación y motivo; escribe un evento crítico en la misma transacción y avisa a la Raíz.
- [ ] Revocar a quien vio un restablecimiento crea una tarea de rotación.
- [ ] Mutación: rebajar el techo a 3 o quitar el nivel MANAGE hace fallar alguna prueba.

**IC-6**
- [ ] Textos en es-MX y en-US con las mismas claves; sin literales; tabla estándar; accesibilidad revisada; ningún secreto en almacenamiento del navegador ni en consola.

**IC-7**
- [ ] El adaptador falso reproduce el mismo contrato que usaría el real (firma, marca de tiempo, identificador único).
- [ ] La pantalla indica "remitente no verificado" en SMS; todo SMS sin plantilla `login_code` explícita es sensible.
- [ ] Ningún flujo del propio sistema usa SMS como factor (ADR 0015).

## Riesgos (resumen; detalle en el ADR 0045, sección "Amenazas y riesgos")

- **Superficie nueva con datos no confiables antes de la prueba de intrusión.** Recomendación mía: hasta esa prueba, solo alias y números de prueba; incluir este alcance en ella.
- **Escalada de USE a toma de la cuenta** (T6): resuelta en la propuesta con clasificación fail-closed y `inbound.reveal_reset`; falta ratificar el techo y el desvío de ACL.
- **El ADR 0021 no cubre la resolución por dirección de destino**: requiere una función nueva y dos revisores.
- **El worker aislado no existe todavía** (corre dentro de la API, ADR 0035): es prerrequisito de IC-3.
- **La verificación DKIM no puede delegarse a un veredicto de proveedor** que no informe firma, `h=`, `l=` ni clave: decisión de recepción abierta.
- **El cifrador ya admite el recurso nuevo** (`SecretContext` es genérico), pero la ruta es protegida y la revisa una persona. Un secreto único de plataforma no tendría DEK de organización.
- **Medir antes de fijar plantillas**: no se verificó que las plataformas del catálogo firmen `Subject`, sobrefirmen cabeceras, eviten `l=` y usen claves de 2048 bits.
- Números VoIP rechazados, SMS como factor débil, remitente de SMS falsificable, spam y costo: ver el ADR.

## Decisiones abiertas (bloquean IC-3 e IC-8; IC-1 no depende de ellas)

1. Subdominio de alias y DNS (`TODO.md` C10, decisión nº 4).
2. SES entrante o SMTP propio (Linode con KMS en AWS) y **dónde corre la verificación DKIM**: prerrequisito de IC-3.
3. Proveedor de SMS.
4. Retención legal (`TODO.md` A10 y C9).
5. Dependencias nuevas que requieren aprobación: parser MIME, lista de sufijos públicos, RE2.
6. Desvío de ACL (vista contra cuenta), tipo `mail_source`, techo de `inbound.reveal_reset` y cifras propuestas.

## Bitácora

- 2026-10-30: encargo del dueño. Se redactan el ADR 0045 (Propuesta), la sección 14 de `docs/business/vault.md`, este documento y las filas de `TODO.md`. **Solo documentación: no se escribió código, migración ni prueba, no se ejecutó nada y no se hizo commit.** Se actualizaron además el índice de ADR y las filas de fases 4 y 5 de `docs/business/roadmap-and-status.md`.
- 2026-10-30 (IC-1, implementada, **sin revisión de jueces, sin mutación ejecutada y sin pruebas corridas**): dominio puro en `apps/api/src/modules/inbound-codes/` (solo `domain/`, `testing/` y la fachada `index.ts`; sin base de datos, red, criptografía ni MIME; no cableado a la API ni al `app.module`). Piezas: `dkim-gate.ts` (resultado estructurado y 15 motivos de rechazo enumerados), `mail-address.ts` y `ascii-text.ts` (normalización mínima), `inbound-template.ts` (plantillas y validación), `value-extraction.ts` (código de largo fijo y enlace de anfitrión permitido), `inbound-classification.ts` (falla cerrada), `item-validity.ts` (TTL de 10 min y tolerancia de 5 min), `message-fingerprint.ts` (deduplicación con hash ya calculado) e `inbound-evaluation.ts` (aceptado o cuarentena). Verificado: `format:check` de los archivos nuevos (prettier), `typecheck` y `lint` (eslint y depcruise, sin reglas desactivadas ni registro nuevo: los globs de capas y la regla de fachadas ya cubren módulos nuevos). **No verificado**: ninguna prueba se ejecutó (por regla del repositorio).
  - Decisiones de IC-1 por confirmar: (1) **sobrefirma estricta**: `From` y `Subject` exigen `h=` con una mención MÁS que las instancias presentes (el criterio dice "conteo menor"; con el conteo igual todavía se puede anteponer una cabecera); `Date` y `To` exigen al menos tantas menciones como instancias y al menos una. (2) `To` debe ser exactamente un destinatario igual al alias. (3) Normalización mínima: solo se bajan a minúsculas `A-Z` y se rechaza cualquier carácter no ASCII visible (nada de `toLowerCase` ni NFKC, que pliegan el signo Kelvin y las letras de ancho completo a ASCII). (4) La fecha firmada debe estar a ±5 min de la recepción (también contra repeticiones); la vigencia cuenta desde la menor de ambas. (5) Un cuerpo de más de 64 KiB o un asunto de más de 512 caracteres va a cuarentena sin truncar. (6) Dos códigos distintos o dos enlaces permitidos distintos en el cuerpo son ambiguos y van a cuarentena. (7) Un enlace es siempre sensible, aunque la plantilla diga `login_code`. (8) `t=` más de 5 min en el futuro se rechaza. (9) Las plantillas con problemas estructurales (patrón enorme, largo fuera de 4 a 12) se ignoran; el tipo desconocido se evalúa y es sensible. Quien guarde plantillas (rebanada posterior) debe llamar a `findTemplateProblems`.
  - Pendiente antes de dar IC-1 por cerrada: dos jueces ciegos sobre este alcance, mutación deliberada de las cinco reglas del criterio (alineación, `l=`, sobrefirma, clasificación por defecto, destinatario) y revisión humana de las pruebas marcadas `// SENSIBLE (revisión humana)`.
- 2026-10-30: revisión por dos jueces ciegos (solo documentación). Se aplicaron sus hallazgos al ADR 0045 (sección "Revisión por jueces 2026-10-30") y a este documento: rebanadas repartidas (IC-2a/2b/2c, IC-3 fusionada con IC-4, IC-5a/5b/5c), criterios y mutaciones nuevos. IC-0 cumplida por el dueño (camino A, "adelante con lo necesario"); solo IC-1 autorizada a empezar.
- 2026-10-30 (IC-1, jueces y mutación): dos jueces ciegos sobre el alcance congelado, ambos "con cambios", sin críticos. **Confirmados por los dos y corregidos**: (1) lectura de enlaces con coste cuadrático (cuerpo de `https://` repetidos): la lectura del candidato se detiene al pasar el tope de largo; (2) correo sin `Date` se aceptaba y su vigencia contaba desde la recepción, lo que permitía reenviar un correo legítimo horas después: ahora va a cuarentena `DATE_MISSING`; (3) una plantilla rota que coincidía con remitente y asunto se ignoraba y otra `login_code` hacía visible un restablecimiento: ahora cuarentena `MATCHED_TEMPLATE_INVALID`; (4) la prueba del signo Kelvin no probaba el plegado Unicode (dominios distintos por una errata): ahora la única diferencia es U+212A. También se arregló la prueba "nunca visible salvo login_code explícito", que en dos casos no llegaba a clasificar. **Aceptado sin cambio, por decisión del dueño**: la sobrefirma estricta (decisión 1 arriba). **No aplicados (un solo juez o menor)**: signos de puntuación finales en enlaces (funcional), `pathPrefix` sin frontera de segmento, `findTemplateProblems` ante datos fuera de tipo (validar al guardar en el catálogo). Verificado: pruebas del dominio 8 archivos, 111/111 en verde (`test-runner`); mutación `if (false && message.dateHeader === null)` detectada por 1 prueba y restaurada (`cmp` idéntico); `format`, `typecheck` y `lint` en verde. **No verificado**: `pnpm build` y otros paquetes; revisión humana de las pruebas marcadas SENSIBLE (pendiente).
- 2026-10-30 (IC-2a, implementada y revisada por dos jueces ciegos): permisos `inbound.read_codes` (techo 3), `inbound.configure` (2) e `inbound.reveal_reset` (1, con reautenticación, motivo escrito y auditoría crítica); `SYSTEM_ROLES_VERSION` 4; migración `0023_inbound_permissions.sql` (redefine `permission_rank_ceiling()` y concede por ancla a roles de sistema vivos, sin tocar personalizados ni archivados); diez acciones `inbound.*` en la lista blanca de auditoría sin direcciones, asuntos ni códigos; etiquetas i18n y grupo `inbound`. Juez B: aprobar. Juez A: con cambios; **corregidos**: faltaba `permission.group.inbound` en es-MX y en-US (lo marcaba el test de roles web) y el test de 0023 no quitaba las migraciones posteriores. **No aplicado**: prueba que compare la concesión de la migración con `SYSTEM_ROLES` (queda para IC-2b) y el comentario "sube uno por rol" de la cabecera de 0023 (impreciso, solo comentario). Mutación: conceder `reveal_reset` a quien tiene `account.archive` fue detectada por 1 prueba y la migración se restauró (`cmp` idéntico). Verificado: pruebas de roles web, 0021 y 0023 (29/29), `format:check`, `typecheck` y `lint`. **No verificado**: `pnpm build` tras los últimos arreglos, e2e, revisión humana de las pruebas SENSIBLE.
- 2026-10-30 (decisión del dueño): aprobó las cuatro propuestas del ADR 0045 y eligió IMAP contra su servidor cPanel (ver enmienda del ADR). Rebanadas nuevas por proponer: conector IMAP de solo lectura, autodetección, almacenamiento cifrado de la contraseña, guarda anti-SSRF y manejo de `Authentication-Results`. Dependencias (cliente IMAP, analizador MIME) pendientes de aprobación.
