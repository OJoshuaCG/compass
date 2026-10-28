# Hoja de ruta y estado

**Fuente en el plan:** "Alcance y hoja de ruta por fases", "Criterios de salida por fase", "Hoja de ruta SSO y preparación del broker tipo Cerby", "Preparación para lectura de correos y SMS", "Estrategia de pruebas" (apartado "Antes de producción"), "Registro de riesgos" y "Decisiones pendientes del equipo". El estado de la fase 0 se toma de [`odd/tasks/phase-0-foundations.md`](../../odd/tasks/phase-0-foundations.md) y del [`README.md`](../../README.md) del repositorio. El estado de la fase 1a se toma de la verificación directa del comportamiento implementado en el backend y en la web y de [`odd/tasks/phase-1a-closure.md`](../../odd/tasks/phase-1a-closure.md).

Este documento explica qué entrega cada fase al negocio, cuándo se considera terminada, en qué punto está el producto hoy y qué decisiones siguen abiertas.

## Contenido

1. [Cómo se avanza](#1-cómo-se-avanza)
2. [Estado actual en una mirada](#2-estado-actual-en-una-mirada)
3. [Fase 0: Fundaciones](#3-fase-0-fundaciones)
4. [Fase 1: identidad, bóveda y gobernanza](#4-fase-1-identidad-bóveda-y-gobernanza)
5. [Puerta de producción](#5-puerta-de-producción)
6. [Fases 2 a 7](#6-fases-2-a-7)
7. [Decisiones del equipo que siguen abiertas](#7-decisiones-del-equipo-que-siguen-abiertas)
8. [Preguntas abiertas](#8-preguntas-abiertas)

## 1. Cómo se avanza

- Cada fase **entrega algo usable** y no se abre la siguiente hasta cumplir sus criterios de salida.
- Las fases se abren **de una en una**. El broker de sesiones queda al final por ser lo más frágil.
- La fase 3 tiene además su propia puerta: confirmar que la organización es elegible para las cuentas administradas de Meta antes de empezar.
- La fase 1 llega a uso interno **solo después de una prueba de intrusión externa**.
- **No se estiman fechas.** Dependen de la escala, de la disponibilidad del equipo y de los hallazgos de la prueba de intrusión. El plan recomienda estimar cada fase al cerrar la anterior.

**Por qué este orden.** El mayor riesgo del proyecto no es técnico sino de alcance: tres personas construyendo a la medida lo que en el mercado son tres productos. Entregar por fases usables y congelar el alcance de cada una evita terminar con un producto a medias que ya guarda secretos reales.

## 2. Estado actual en una mirada

| Fase | Qué entrega al negocio | Estado |
| --- | --- | --- |
| 0 · Fundaciones | Una base técnica segura, sin pantallas de negocio todavía | **Hecho** (con una observación, ver sección 3) |
| 1a · Identidad | Invitar personas, jerarquía, permisos, segundo factor obligatorio y entrada con passkey | **Implementada en lo esencial, con pendientes** (el segundo factor funciona con aplicación autenticadora o con passkey, y la Raíz ya tiene códigos de emergencia; faltan los límites de intentos compartidos y otros pendientes; ver sección 4.1) |
| 1b · Bóveda y 2FA | Cuentas, credenciales, compartición, revelación auditada y códigos de segundo factor | **No iniciada.** Planificada en siete porciones (ver sección 4.2) |
| 1c · Gobernanza | Auditoría con interfaz, bajas con rotación, panel de salud, acceso temporal y alertas | Pendiente |
| Puerta de producción | Prueba de intrusión, simulacro de restauración y procedimientos ensayados | Pendiente |
| 2 · Inicio de sesión único (OIDC) | Que las herramientas internas usen este sistema para iniciar sesión | Pendiente |
| 3 · SAML y SCIM | Entrada a Meta Business y altas y bajas automáticas en otras plataformas | Pendiente |
| 4 · Correos | Lectura automática de códigos que llegan por correo | Pendiente |
| 5 · SMS | Lectura de códigos por mensaje de texto | Pendiente |
| 6 · Extensión de navegador | Autocompletado de usuario y segundo factor | Pendiente |
| 7 · Broker de sesiones | Iniciar sesión en una plataforma sin ver la contraseña | Pendiente |

## 3. Fase 0: Fundaciones

**Qué entrega.** Los cimientos que hacen posibles las demás fases. No incluye funciones que una persona de negocio pueda usar todavía.

| Cimiento | Qué significa para el negocio |
| --- | --- |
| Cifrado de secretos con claves por organización | Los secretos que se guarden en el futuro estarán cifrados desde la primera línea |
| Auditoría encadenada | La evidencia nace a prueba de manipulación |
| Aislamiento entre organizaciones en la base de datos | Aunque hoy hay una sola organización, no habrá que migrar datos al añadir otra |
| Interfaz base con tema oscuro y dos idiomas (español de México e inglés) | Todas las pantallas nacen bilingües y accesibles |
| Documentación de decisiones, arquitectura, amenazas y procedimientos | Las decisiones quedan registradas (ADR 0001 a 0038) |
| Verificación automática (CI) | Cada cambio se comprueba solo antes de aceptarse |

**Criterio de salida:** CI completo en verde; cifrado, auditoría y contexto de organización con pruebas; aislamiento por organización activo; esqueleto de interfaz con tokens oscuros e idiomas; ADR 001 a 020 escritos.

**Estado: hecho.** Según el seguimiento de la fase, todas las tareas están terminadas y revisadas por una revisión independiente que concluyó sin hallazgos pendientes.

**Observación.** El seguimiento indica que el flujo de verificación automática (CI) quedó definido pero **no se ha ejecutado todavía en GitHub**. El criterio de salida pide CI "en verde"; hasta que corra ahí, esa parte del criterio solo está comprobada de forma local.

## 4. Fase 1: identidad, bóveda y gobernanza

La fase 1 se divide en tres entregas. Llega a producción interna solo después de la puerta de producción.

### 4.1 Fase 1a: Identidad (implementada en lo esencial, con pendientes)

| Qué entrega | Documento donde se explica |
| --- | --- |
| Invitación, contraseña, segundo factor obligatorio y entrada con passkey | [`authentication.md`](authentication.md) |
| Los cuatro actores, la regla de gestión, bajas con reasignación y transferencia de la Raíz | [`actors-and-hierarchy.md`](actors-and-hierarchy.md) |
| Catálogo de permisos, roles y no escalamiento | [`permissions-and-sharing.md`](permissions-and-sharing.md) |
| Reautenticación para acciones sensibles | [`permissions-and-sharing.md`](permissions-and-sharing.md) |
| Sesiones propias y ajenas, roles personalizados e invitaciones reenviables | [`authentication.md`](authentication.md), [`permissions-and-sharing.md`](permissions-and-sharing.md) |

**Criterio de salida (según el plan):** invitación → contraseña → segundo factor obligatorio → entrada con passkey de punta a punta; matriz de jerarquía y permisos completa en verde; reautenticación funcionando.

#### Lo que ya funciona

| Capacidad | Qué hace hoy |
| --- | --- |
| Alta de una organización | Una persona de operaciones da de alta la organización con un comando propio, y el alta queda en la auditoría. Nace con exactamente una Raíz, en estado "invitada", con una contraseña inicial aleatoria que se muestra una sola vez y nunca se guarda en claro, y con las cuatro plantillas de rol del sistema. Junto a la contraseña se imprimen una sola vez ocho códigos de emergencia de la Raíz, para imprimirlos y entregarlos a las dos personas que los custodian |
| Códigos de emergencia de la Raíz | Si la Raíz pierde su segundo factor, uno de los códigos de emergencia, después de su contraseña, restablece ese segundo factor y la obliga a registrar uno nuevo. Cada código sirve una sola vez. Se cierran las demás sesiones de la Raíz, el uso queda como evento crítico y se avisa por correo a todos los Administradores activos; si el aviso falla o no hay Administradores a quienes avisar, también queda registrado. Los códigos que no se usaron siguen vigentes. Solo quienes custodian los códigos pueden restablecer la Raíz: ningún Administrador puede hacerlo, solo recibe la alerta. El código no sustituye a la contraseña |
| Passkeys | Quien tiene passkeys ve, tras la contraseña, la opción de usar una passkey en lugar del código de la aplicación autenticadora. Son opcionales para todas las personas, resistentes al phishing, y cada persona puede tener varias (hasta 10), con nombre. Agregar o quitar una exige haber confirmado la identidad hace poco, y hay una pantalla de seguridad para gestionarlas. Los fallos cuentan en el mismo límite de intentos que el código. Cada alta, baja e ingreso con passkey queda en la auditoría |
| Correo de invitación | Sale del servidor de correo del dominio propio de la organización, con conexión cifrada obligatoria y certificado verificado. Se redacta en español de México o en inglés de Estados Unidos, el enlace lleva el token de modo que no queda en los registros de acceso y la fecha de vencimiento se indica en hora universal. Los errores del proveedor no se muestran porque podrían citar al destinatario o el contenido. En producción el envío real es obligatorio |
| Cambio obligatorio de la contraseña inicial | En su primer ingreso, la Raíz debe cambiar la contraseña inicial antes de registrar su segundo factor. El cambio exige la contraseña actual, aplica la política de contraseñas, cuenta los intentos fallidos con el mismo límite y cierra las demás sesiones de la persona |
| Gestión de personas | Quien gestiona a una persona puede suspenderla, reactivarla, desactivarla, cambiarle el rango o transferirla a otro responsable. Suspender y desactivar cierran sus sesiones; desactivar reasigna a sus subordinados activos y revoca las invitaciones pendientes que dejó. La Raíz queda protegida de todas estas acciones. Cada acción se audita y la pestaña de gestión de equipo de la página de Usuarios las ofrece |
| Invitaciones | Quien tiene el permiso de invitar crea una invitación según la matriz de creación, sin poder otorgar permisos que no tiene. El enlace llega por correo, vence a las 72 horas y es de un solo uso. Quien invita no lo ve ni conoce la contraseña. Al aceptar se revalidan los roles y que quien invitó siga activo. Se puede reenviar una invitación (solo quien la envió o la Raíz): el enlace anterior queda invalidado y se envía uno nuevo con otras 72 horas. Una pestaña de invitaciones muestra las pendientes y señala las vencidas |
| Roles personalizados | Quien puede gestionar roles crea roles con permisos que no excedan los suyos, los edita (nombre y permisos, solo si tiene todos los permisos que el rol incluye) y los archiva. Las plantillas del sistema no se archivan; un rol archivado deja de otorgar permisos y no sirve en invitaciones nuevas. Al invitar se puede elegir un rol personalizado de forma opcional |
| Sesiones propias y ajenas | Cada persona ve sus sesiones, con dispositivo, dirección de red y última actividad, y cierra las demás. Quien gestiona a una persona puede cerrar todas sus sesiones, salvo las de la Raíz. Al salir o perder la sesión, las demás pestañas del navegador pasan al ingreso en cerca de un segundo. Ambas acciones se auditan |
| Protección contra reintentos de creación | Las peticiones que crean recursos exigen una clave de reintento; repetir la misma petición dentro de 24 horas devuelve la misma respuesta sin crear nada de nuevo, y usar la clave con otra petición se rechaza. Hoy se aplica a invitaciones, reenvíos y roles |
| Alta de la persona invitada | Contraseña (mínimo 12 caracteres, sin reglas de composición, se rechazan las comunes y las que contienen datos personales), segundo factor obligatorio con confirmación y 10 códigos de recuperación que se muestran una sola vez. Solo entonces la persona queda activa |
| Inicio de sesión | Contraseña más segundo factor (código de la aplicación autenticadora o código de recuperación de un solo uso). Un código de la aplicación no se puede reutilizar. Mensajes y tiempos equivalentes para usuario inexistente o contraseña incorrecta |
| Protección contra fuerza bruta | Retraso progresivo y bloqueo temporal de 15 minutos tras 10 intentos fallidos, nunca permanente, contado por correo y por usuario. Además, un límite por dirección de red en las pantallas de acceso e invitación |
| Sesiones | Identificador de sesión protegido, caducidad por inactividad de 30 minutos y absoluta de 12 horas, cierre de sesión que la revoca en el servidor y protección contra solicitudes desde otros sitios. Una persona suspendida o dada de baja deja de poder usar su sesión |
| Reautenticación | Un factor verificado en los últimos 5 minutos habilita las acciones sensibles. El motor de autorización exige reautenticación, motivo escrito o auditoría crítica según la acción. Solo se acepta el código de la aplicación autenticadora, no el de recuperación; el flujo completo se prueba en un navegador real |
| Autorización | Los tres ejes, la matriz de jerarquía y el catálogo de 27 permisos con sus techos de rango. Toda negación se audita con su código de motivo, aunque la acción se revierta |
| Directorio de personas | Cualquier persona activa busca nombre y correo de las demás personas activas, con orden, límite y paginación |
| Interfaz | Pantallas de ingreso (con la opción de passkey), verificación en dos pasos, registro del segundo factor (código QR y clave), cambio de contraseña, aceptación de invitación, directorio con la opción de invitar, gestión de equipo, invitaciones pendientes, roles, mis sesiones, seguridad (passkeys) y diálogo de reautenticación |

Las pruebas de punta a punta de la fase (invitación, alta, segundo factor, ingreso, sesión y autorización) pasan contra una base de datos real, no simulada.

#### Lo que sigue pendiente en la fase 1a

| Pendiente | Efecto en el negocio |
| --- | --- |
| Exigir passkeys a la Raíz y a los Administradores | Hoy son opcionales para todos. Exigirlas queda como una futura configuración de la organización: todavía no hay pantalla de configuración y un registro forzado, sin alternativa, podría dejar a las personas fuera |
| Recuperación de la Raíz sin contraseña (caída total de los códigos) | La Raíz que olvida su contraseña y pierde sus factores se recupera con el concurso de las dos personas custodias. Si ya no quedan códigos de emergencia vigentes de cada custodio, o la organización es anterior a la asignación de custodios, no hay recuperación en el sistema; hace falta el procedimiento de caída total, que sigue pendiente |
| Límites de intentos compartidos | Los contadores viven en la memoria de cada instancia del servidor. Con más de una instancia, cada una cuenta por separado y un reinicio los borra. Falta el almacén compartido de contadores; no entró en esta entrega |
| Dominio de envío del correo | Para que las invitaciones lleguen a la bandeja de entrada, el dominio de la organización necesita registros de autenticación del remitente (SPF, DKIM y DMARC) en su configuración de DNS. Es una tarea del equipo, fuera del sistema |
| Limpieza de datos temporales vencidos | Las claves de la protección contra reintentos y los desafíos de passkeys vencidos aún no se borran (falta una tarea de limpieza). Además, un reintento dentro de las 24 horas no vuelve a comprobar los permisos de quien lo hace |
| Transferencia de la Raíz | No existe. Las demás acciones de gestión de personas ya funcionan |
| Cierre automático de sesiones al cambiar roles y avisos por correo | La acción de cambiar roles aún no existe. Los avisos por correo son parciales: la persona ya recibe el de uso de un código de recuperación y el de alta o baja de una llave de acceso; faltan el de dispositivo nuevo y los de baja del factor de aplicación y regeneración de códigos |
| Reautenticación con código de recuperación | No está soportada; solo se acepta el código de la aplicación autenticadora |
| Ejecución de las pruebas en la verificación automática (CI) de GitHub | Nunca se ha ejecutado. Las pruebas pasan en el entorno local. El dueño la despriorizó ("no es primordial ni la requerimos"); no está bloqueada, y el repositorio ya tiene remoto |
| Passkeys: reautenticación y alta inicial | La reautenticación de 5 minutos solo acepta el código de la aplicación autenticadora, y las passkeys se agregan después del alta inicial, que usa la aplicación. Revisadas por dos revisores ciegos; sus hallazgos están corregidos |

#### Criterios de salida: cuáles se cumplen

| Criterio del plan | Estado | Detalle |
| --- | --- | --- |
| Invitación → contraseña → segundo factor obligatorio | Cumplido | De punta a punta con aplicación autenticadora; la passkey es una alternativa opcional, no obligatoria (ADR 0028) |
| Entrada con passkey | Cumplido | Funciona de punta a punta, probada en un navegador real con un autenticador virtual. Es opcional para todas las personas |
| Matriz de jerarquía y permisos completa en verde | Cumplido | La matriz de creación, la regla de gestión y el catálogo de 27 permisos con techos están implementados y probados, y las acciones de gestión de personas ya los usan. Sigue pendiente la transferencia de la Raíz |
| Reautenticación funcionando | Cumplido con aplicación autenticadora | Probada también en navegador real. Aún no admite passkey ni código de recuperación |
| Verificación automática (CI) en verde | **No comprobado** | Definida, nunca ejecutada en GitHub; despriorizada por el dueño |

**Conclusión.** La fase 1a funciona en lo esencial, pero no se da por cerrada: la entrada con passkey y los códigos de emergencia de la Raíz ya existen y fueron revisados, y quedan pendientes de seguridad, como los límites de intentos compartidos entre instancias (mientras tanto el sistema debe operar con una sola instancia) y el procedimiento de caída total de los códigos de emergencia (la recuperación de una Raíz que pierde contraseña y factores ya existe), que deben resolverse antes de la puerta de producción. La fase 1b no ha empezado.

### 4.2 Fase 1b: Bóveda y 2FA (no iniciada)

**Estado.** Las tablas y el cifrado existen desde la fase 0, pero todavía no hay casos de uso, pantallas ni reglas de la bóveda en funcionamiento. El trabajo está planificado en siete porciones, en este orden: cuentas y acceso efectivo; credenciales y revelación; compartición y grupos; segundo factor en el servidor; registro del segundo factor por captura, importación y celular; búsqueda avanzada; importación por CSV. Sigue vigente que **no debe cargarse ninguna credencial real** hasta cerrar la fase 1 y pasar la prueba de intrusión externa.

Decisiones abiertas de esta fase: qué biblioteca se aprobará para leer códigos QR en el navegador; el límite de revelaciones por persona y hora (el plan propone 30) y cómo se avisa al superarlo; y el largo mínimo y el formato del motivo escrito al revelar.

| Qué entrega | Documento donde se explica |
| --- | --- |
| Alta de cuentas y credenciales, compartición por persona y por grupo | [`vault.md`](vault.md), [`permissions-and-sharing.md`](permissions-and-sharing.md) |
| Revelación auditada de contraseñas | [`vault.md`](vault.md) |
| Los cinco métodos de registro del segundo factor, con confirmación, y códigos generados en el servidor | [`two-factor.md`](two-factor.md) |
| Importación por CSV (al final de la fase) | [`vault.md`](vault.md) |

**Criterio de salida:** alta de cuentas y credenciales; compartición por persona y grupo; revelación auditada; los cinco métodos de registro del segundo factor con confirmación; códigos generados en el servidor.

### 4.3 Fase 1c: Gobernanza (pendiente)

| Qué entrega | Documento donde se explica |
| --- | --- |
| Auditoría con cadena verificada y su interfaz | [`governance.md`](governance.md) |
| Bajas con reasignación y tareas de rotación | [`governance.md`](governance.md) |
| Panel de salud de credenciales | [`governance.md`](governance.md) |
| Acceso temporal con aprobación | [`governance.md`](governance.md) |
| Alertas críticas activas | [`governance.md`](governance.md) |

**Criterio de salida:** auditoría con cadena verificada y interfaz; baja con reasignación y tareas de rotación; panel de salud; acceso temporal; alertas críticas activas.

## 5. Puerta de producción

Antes de cargar credenciales reales, y después de completar 1a, 1b y 1c, se debe cumplir **todo** lo siguiente:

| Condición | Detalle |
| --- | --- |
| Prueba de intrusión externa independiente | Sin hallazgos altos ni críticos abiertos. Cubre autorización, aislamiento, cifrado, sesiones y flujos de segundo factor |
| Simulacro de restauración exitoso | Restauración completa en un entorno aislado, incluido abrir los secretos con las claves de cifrado |
| Procedimientos de incidentes ensayados | Los procedimientos de incidentes y recuperación de [`../runbooks/`](../runbooks/README.md), incluido el de caída total. Los catorce están redactados como borrador y ninguno se ha ensayado |

**Regla:** no se cargan credenciales reales hasta cerrar los hallazgos altos y críticos. La prueba de intrusión se repite antes de cada fase de inicio de sesión único.

**Estado: pendiente.** Los procedimientos son hoy borradores sin ensayar. El presupuesto de la prueba de intrusión sigue como decisión abierta.

## 6. Fases 2 a 7

Cada fase reutiliza la identidad, los permisos y la auditoría de la anterior.

| Fase | Qué entrega al negocio | Criterio de salida | Estado |
| --- | --- | --- | --- |
| 2 · Inicio de sesión único con OpenID Connect | El sistema actúa como proveedor de inicio de sesión para herramientas internas y servicios que lo acepten. Registro de aplicaciones solo por administradores. Al desactivar a una persona, se cierran sus sesiones en las aplicaciones conectadas | Al menos una aplicación interna con inicio de sesión, cierre de sesión coordinado y revocación al desactivar personas | Pendiente |
| 3 · SAML y aprovisionamiento automático (SCIM) | Entrada a Meta Business con cuentas administradas de Meta, de modo que desactivar a alguien aquí le quita el acceso a páginas, anuncios e Instagram. Altas y bajas automáticas en las plataformas que lo soporten | Entrada a Meta Business con cuentas administradas y baja automática verificada | Pendiente. Tiene una puerta propia: confirmar antes la elegibilidad de la organización para cuentas administradas de Meta |
| 4 · Correos | Los códigos que llegan por correo se leen y se muestran a quien tenga USE. Cada cuenta ya recibe un alias propio desde la fase 1 | Códigos extraídos para las plataformas del catálogo, con la autenticidad del remitente verificada y vigencia corta | Pendiente |
| 5 · SMS | Números de teléfono operativos para plataformas que no ofrecen otro segundo factor | Números operativos para plataformas sin código de aplicación autenticadora | Pendiente |
| 6 · Extensión de navegador | Autocompletado de usuario y segundo factor desde el navegador, con sesión ligada al dispositivo | Autocompletado de usuario y segundo factor desde la extensión con sesión de dispositivo | Pendiente |
| 7 · Broker de sesiones | Que una persona con nivel USE inicie sesión en una plataforma sin ver la contraseña | Inicio de sesión con USE sin revelar la contraseña en al menos una plataforma, con monitoreo de fallas | Pendiente |

### 6.1 Reglas de negocio que traen las fases futuras

| Fase | Regla |
| --- | --- |
| 2 | Solo flujos seguros: sin flujos heredados inseguros; las aplicaciones se registran a mano y solo por quienes tienen el permiso correspondiente; las claves de firma se rotan cada 90 días |
| 3 | Antes de empezar se confirma la elegibilidad para cuentas administradas de Meta; hay revisión de seguridad dedicada del protocolo SAML |
| 4 | El remitente debe estar verificado; un correo que no coincide con las reglas de la plataforma va a cuarentena; el código se guarda cifrado con vigencia de 10 minutos; los enlaces de restablecimiento de contraseña exigen MANAGE y se auditan como evento crítico |
| 5 | El SMS es el factor más débil: se prefiere siempre el código de aplicación autenticadora y el SMS se usa solo cuando no hay otra opción; varias plataformas rechazan números virtuales |
| 6 | La extensión protege contra la exposición casual, no contra una persona decidida con herramientas de desarrollador |
| 7 | Es lo más frágil: puede chocar con las protecciones de las plataformas contra automatización y con sus términos de uso. Queda al final y como opcional |

### 6.2 Qué se deja preparado desde la fase 1

Para que el broker y las fases futuras no obliguen a rehacer lo anterior, la fase 1 deja listo, sin construirlo:

1. Que el nivel USE ya excluya revelar la contraseña.
2. Que toda lectura de un secreto declare su propósito (revelar, código de segundo factor, exportar o inyectar), y que el último esté deshabilitado.
3. Puntos de conexión definidos para iniciar sesión en una plataforma, entregar una sesión y cambiar una contraseña, sin implementación.
4. Un catálogo de plataformas que ya reserva cómo iniciar sesión y cómo reconocer correos.
5. Un tipo de sesión de dispositivo para la extensión, aunque no se emita todavía.
6. Acciones de auditoría reservadas para la inyección de credenciales, el inicio de sesiones delegadas y la rotación automática.

## 7. Decisiones del equipo que siguen abiertas

La documentación del repositorio solo registra el cierre de dos de las decisiones pendientes del plan (la 7, decidida, y la 9, parcialmente, ambas el 2026-10-27); las demás siguen abiertas. El plan indica que ninguna bloquea la fase 0, pero que las cuatro primeras debían cerrarse antes de terminarla.

| N.º | Decisión | Por qué importa | Estado según la documentación |
| --- | --- | --- | --- |
| 1 | Proveedor de nube (AWS es la referencia) | Define el servicio de claves, la base de datos gestionada y el correo | Abierta (el ADR de referencia indica confirmación pendiente) |
| 2 | Escala esperada el primer año (usuarios, cuentas y revelaciones diarias) | Ajusta límites, vigencias y tamaño de la infraestructura | Abierta |
| 3 | Disponibilidad requerida (horario y tolerancia a caídas) | Valida el objetivo de pérdida máxima de 5 minutos y de recuperación de 4 horas | Abierta |
| 4 | Subdominio para los alias de las cuentas, con su configuración de DNS | Permite crear cada cuenta con su correo definitivo desde el primer día | Abierta |
| 5 | Presupuesto de la prueba de intrusión externa | Es condición para cargar credenciales reales | Abierta |
| 6 | Política de retención de la auditoría y de las versiones de secretos, validada por el área legal | Define cuánto tiempo se conserva cada dato | Abierta |
| 7 | Exigir passkeys a la Raíz y a los Administradores desde el inicio (el plan recomienda que sí) | Eleva la seguridad de las cuentas con más poder | Decidido (2026-10-27): las passkeys son opcionales para todos; exigirlas queda como futura configuración de la organización, porque aún no hay pantalla de configuración y un registro forzado sin alternativa podría dejar a las personas fuera |
| 8 | Elegibilidad para cuentas administradas de Meta (antes de la fase 3) | Sin ella, la fase 3 pierde su objetivo principal | Abierta |
| 9 | Personas que custodiarán los códigos de emergencia de la Raíz (dos) | Sin custodios no hay recuperación posible de la Raíz | Parcialmente decidida (2026-10-27): solo quienes custodian los códigos pueden restablecer la Raíz y ningún Administrador puede hacerlo, para que no sea un camino de toma de la cuenta de mayor privilegio. Los códigos ya existen; sigue abierto quiénes son las dos personas custodias |

### 7.1 Decisiones que la implementación de la fase 1a tuvo que asumir

El plan no fijaba estos valores. La implementación adoptó una opción para poder avanzar y queda **pendiente de confirmar con el negocio**:

| N.º | Decisión asumida | Dónde se explica |
| --- | --- | --- |
| A | Los permisos por defecto de las plantillas de Líder y de Operador son "todo lo que su rango puede tener" | [`permissions-and-sharing.md`](permissions-and-sharing.md) |
| B | Tras 10 intentos fallidos hay un bloqueo temporal de 15 minutos, con retraso progresivo desde el tercer fallo | [`authentication.md`](authentication.md) |
| C | La Raíz nace en estado "invitada", con una contraseña inicial aleatoria que se cambia en el primer ingreso | [`actors-and-hierarchy.md`](actors-and-hierarchy.md) y [`authentication.md`](authentication.md) |

## 8. Preguntas abiertas

Además de las decisiones anteriores, estos puntos no están definidos por el plan:

| N.º | Pregunta | Por qué importa |
| --- | --- | --- |
| 1 | Cuándo se ejecutará la verificación automática en GitHub y si el criterio "CI completo en verde" se considera cumplido antes de esa ejecución | Las fases 0 y 1a se consideran avanzadas, pero esa ejecución nunca ha ocurrido. El dueño la despriorizó el 2026-10-27; el repositorio ya tiene remoto |
| 2 | Quién es el equipo de guardia para incidentes | Los procedimientos sugieren responsables, pero el plan no fija un equipo de guardia |
| 3 | Cuándo se resuelven las dos decisiones técnicas que siguen en estado de propuesta: los bloqueos de auditoría en transacciones largas y la retención de auditoría | La auditoría de las negaciones ya quedó resuelta y aceptada en la fase 1a. Las dos restantes afectan a la auditoría de acciones largas y a cuánto tiempo se conserva. Ver [`docs/adr/`](../adr/README.md) |
| 4 | Qué documento fija el procedimiento de caída total | Ya hay un borrador en [`../runbooks/total-outage.md`](../runbooks/total-outage.md), sin ensayar. Falta definir la administración directa de la base de datos cuando no quedan códigos de emergencia y la política de los sobres sellados |
| 5 | Si la fase 1a puede darse por cerrada sin el almacén compartido de contadores de intentos y sin el procedimiento de caída total de los códigos de emergencia | Las passkeys, los códigos de emergencia y la recuperación de la Raíz ya existen; esos dos pendientes siguen abiertos |
| 6 | Cuál es el dominio de envío del correo y quién configura sus registros de autenticación del remitente | Se decidió que el correo sale del dominio propio de la organización; el dominio concreto y su configuración de DNS dependen del equipo |
