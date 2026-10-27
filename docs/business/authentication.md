# Autenticación: cómo entran las personas al sistema

**Fuente en el plan:** "Autenticación del propio sistema" (incluye "Alta de usuarios: siempre por invitación", "Factores", "Sesiones", "Reautenticación (step-up)", "Protección contra ataques", "Recuperación de acceso" y "Login con proveedores externos"), "Actores y jerarquía: reglas formales" (recuperación de la Raíz) y "Decisiones cerradas (ADR)" (decisiones 014 y 015).

Este documento explica cómo una persona llega a tener acceso al sistema, cómo demuestra quién es cada vez, cuánto dura su sesión y qué ocurre si pierde sus medios de acceso. Se refiere al acceso **al propio sistema**; el segundo factor de las plataformas externas está en [`two-factor.md`](two-factor.md). Los personajes de los ejemplos están en el [glosario](README.md#personajes-de-los-ejemplos).

## Qué funciona hoy (fase 1a)

Este documento describe el comportamiento completo previsto. La fase 1a ya implementó una parte; el resto sigue pendiente. Cada sección indica su estado, y esta tabla lo resume.

| Tema | Estado hoy |
| --- | --- |
| Alta por invitación (72 horas, un solo uso, quien invita no conoce la contraseña) | **Funciona.** El envío real del correo está pendiente: hoy el enlace solo se registra en el servidor en desarrollo |
| Contraseña (12 caracteres, sin composición, rechazo de comunes y de datos personales) | **Funciona** |
| Segundo factor con aplicación autenticadora y 10 códigos de recuperación | **Funciona** |
| Passkeys | **Pendiente.** No están implementadas |
| Inicio de sesión con segundo factor o código de recuperación | **Funciona** |
| Retraso progresivo, bloqueo temporal y mensajes idénticos | **Funciona.** Los contadores son por instancia del servidor; falta el almacén compartido |
| Sesiones (30 minutos de inactividad, 12 horas absolutas, cierre en el servidor) | **Funciona** |
| Ver y cerrar sesiones, cierre por el responsable, sincronización entre pestañas | **Funciona** |
| Cierre automático de sesiones al suspender, desactivar o cambiar el rango | **Funciona** (el cambio de roles aún no existe como acción) |
| Reautenticación de 5 minutos | **Funciona** con la aplicación autenticadora (probada también en navegador real). No admite código de recuperación |
| Avisos por correo (dispositivo nuevo, código de recuperación, cambios de factores) | **Pendiente** |
| Recuperación por el responsable o la Raíz; códigos de emergencia de la Raíz | **Pendiente** |
| Cambio de contraseña, incluido el cambio obligatorio de la contraseña inicial de la Raíz | **Funciona** |
| Inicio de sesión con proveedores externos | Fuera de la primera versión |

## Contenido

1. [Por qué el acceso debe ser el más fuerte](#1-por-qué-el-acceso-debe-ser-el-más-fuerte)
2. [Alta por invitación](#2-alta-por-invitación)
3. [Los factores de acceso](#3-los-factores-de-acceso)
4. [Sesiones](#4-sesiones)
5. [Reautenticación](#5-reautenticación)
6. [Protección contra ataques](#6-protección-contra-ataques)
7. [Recuperación de acceso](#7-recuperación-de-acceso)
8. [Inicio de sesión con proveedores externos](#8-inicio-de-sesión-con-proveedores-externos)
9. [Reglas numeradas](#9-reglas-numeradas)
10. [Preguntas abiertas](#10-preguntas-abiertas)

## 1. Por qué el acceso debe ser el más fuerte

El sistema guarda las contraseñas y los segundos factores de toda la organización. Quien entre al sistema como otra persona obtiene todo lo que esa persona puede ver. Por eso el acceso a la plataforma debe ser más exigente que el de cualquiera de las plataformas que protege:

- El segundo factor es **obligatorio desde la primera sesión**.
- Las **passkeys** son el método preferido.
- Las sesiones se pueden cerrar al instante.

## 2. Alta por invitación

**Nadie se registra solo.** Toda persona entra por invitación.

| Paso | Qué ocurre |
| --- | --- |
| 1 | Quien tiene el permiso de invitar crea la invitación: correo, rango, responsable y roles iniciales. El sistema valida la matriz de creación y el no escalamiento (ver [`actors-and-hierarchy.md`](actors-and-hierarchy.md)) |
| 2 | El sistema envía un enlace de **un solo uso**, vigente **72 horas** |
| 3 | La persona invitada define su contraseña y registra **obligatoriamente** un segundo factor (una passkey o una aplicación autenticadora) antes de poder entrar. *Hoy solo está disponible la aplicación autenticadora* |
| 4 | El sistema entrega **10 códigos de recuperación** de un solo uso. Se muestran una sola vez. Solo cuando la persona confirma el segundo factor con un código válido queda activa |

Reglas importantes:

- **Quien invita nunca conoce la contraseña** de la persona invitada. Tampoco ve el enlace: llega solo al correo de la persona invitada.
- **Reenviar una invitación invalida la anterior**; solo la última sirve. Solo puede reenviarla quien la envió o la Raíz. El reenvío genera un enlace nuevo con otras 72 horas y lo envía por correo; si no se puede crear la nueva, la anterior sigue vigente. Mientras una invitación siga vigente no se puede crear otra para el mismo correo, y una invitación vencida no impide volver a invitar a ese correo. Cada persona ve sus invitaciones pendientes, con las vencidas señaladas; la Raíz ve las de todos.
- Nadie se invita como Raíz: la Raíz existe desde la creación de la organización.
- **Al aceptar se revalida todo.** Entre invitar y aceptar pueden pasar hasta 72 horas. Al aceptar, el sistema vuelve a comprobar que los roles siguen existiendo, que quien invitó sigue activo y que todavía puede otorgar esos roles. Si algo cambió, la persona ve el mismo mensaje que ante una invitación inválida, sin saber la causa.
- **Todas las invitaciones inválidas se ven igual.** Una invitación vencida, ya usada o inexistente produce el mismo mensaje, para no revelar qué le pasó.

**La Raíz.** Cuando una persona de operaciones da de alta una organización, el sistema crea a la Raíz en estado "invitada" con una contraseña inicial aleatoria de 24 caracteres, que se muestra una sola vez a quien da de alta la organización y nunca se guarda en claro. En su primer ingreso con esa contraseña, el sistema le avisa antes que nada que debe cambiarla, y mientras no lo haga no puede registrar ni verificar su segundo factor. Para cambiarla debe escribir la contraseña actual; la nueva sigue la misma política de contraseñas y no puede ser igual a la actual. Los intentos fallidos se cuentan con el mismo límite del ingreso, y el contador se reinicia al demostrar la contraseña actual. Al cambiarla, se cierran las demás sesiones de esa persona. Tanto el cambio como los intentos fallidos quedan en la auditoría. Después registra su segundo factor, y solo entonces queda activa (ver [preguntas abiertas](#10-preguntas-abiertas)).

**Ejemplo.** Luis invita a Sofía como Operadora. Sofía recibe el correo, abre el enlace dentro de las 72 horas, define su contraseña, registra una passkey en su laptop y recibe sus diez códigos de recuperación. Los imprime y los guarda. Solo entonces puede entrar. Si el enlace hubiera vencido, Luis tendría que enviar una nueva invitación.

## 3. Los factores de acceso

| Factor | Cómo es | Papel |
| --- | --- | --- |
| Contraseña | Mínimo 12 caracteres, sin reglas de composición (no se exige mezclar mayúsculas, números ni símbolos); se rechazan las contraseñas comunes y las demasiado débiles según un puntaje mínimo | Primer factor |
| Passkey | Acceso con el dispositivo (huella, rostro o llave de seguridad), resistente a la suplantación. Se pueden registrar varias, cada una con un nombre, por ejemplo "Laptop oficina" | Segundo factor **preferido**. **Pendiente: no está implementada** |
| Aplicación autenticadora | Código de seis dígitos que cambia cada 30 segundos. Un mismo código no se puede usar dos veces | Alternativa para quien no pueda usar passkeys. **Hoy es el único segundo factor disponible** |
| Códigos de recuperación | Diez códigos de un solo uso. Sirven para completar el ingreso, pero no para reautenticarse | **Último recurso**. Funciona |

**Qué no se usa.** No se usan mensajes de texto ni correo como segundo factor del propio sistema. Son los métodos más fáciles de interceptar o de suplantar, y el sistema protege el segundo factor de toda la organización.

**Por qué no hay reglas de composición.** Las guías vigentes de identidad digital (NIST) recomiendan priorizar la longitud y bloquear contraseñas conocidas sobre exigir combinaciones de caracteres, que producen contraseñas predecibles.

**Política por organización.** La organización puede exigir passkeys a la Raíz y a los Administradores. El plan recomienda activarla desde el inicio (sigue como decisión pendiente).

**Aviso de uso de un código de recuperación.** Usar uno notifica a la propia persona y a su responsable. *Hoy el uso queda registrado en la auditoría, pero todavía no se envía el aviso por correo.*

## 4. Sesiones

Una sesión es el periodo en que una persona permanece autenticada.

| Aspecto | Regla |
| --- | --- |
| Caducidad por inactividad | **30 minutos** sin actividad (configurable por organización) |
| Caducidad absoluta | **12 horas** desde el ingreso (configurable por organización) |
| Dónde viaja | En un identificador de sesión protegido que guarda el navegador; la web y la API comparten origen, y no se guarda nada sensible en el almacenamiento del navegador |
| Ver y cerrar | Cada persona ve sus sesiones activas y puede cerrar las demás. La sesión que está usando se cierra saliendo del sistema |
| Cierre por el responsable | El responsable de una persona puede cerrar **todas** sus sesiones. Requiere el permiso de desactivar, respeta la jerarquía y nunca alcanza a la Raíz |
| Cierre automático | Desactivar o suspender a una persona, o cambiarle el rango o los roles, cierra sus sesiones **en el acto** |
| Varias pestañas | Al salir o perder la sesión, las demás pestañas del mismo navegador pasan a la pantalla de ingreso en cerca de un segundo |

**Estado hoy.** Funcionan: el identificador de sesión protegido, la caducidad por inactividad (30 minutos) y absoluta (12 horas), el cierre de sesión que la revoca en el servidor, la protección contra solicitudes enviadas desde otros sitios y el rechazo de la sesión de una persona suspendida o dada de baja. La caducidad por inactividad se calcula con el reloj del servidor de la aplicación, una sola fuente de tiempo (ver [ADR 0025](../adr/0025-session-time-single-clock-source.md)). Mientras la persona no complete el segundo factor, su sesión solo sirve para completarlo. Suspender o desactivar a una persona cierra todas sus sesiones en la misma operación, y también lo hace el cambio de contraseña con las demás sesiones de esa persona. Cada persona dispone de una pantalla "Mis sesiones" con fecha de creación, última actividad, vencimiento, dispositivo y dirección de red de cada sesión, y con la actual señalada; nunca se muestra nada que permita usar la sesión. Cerrar una sesión ajena a la persona, o ya cerrada, se rechaza como si no existiera. El responsable cierra todas las sesiones de una persona desde el menú de la fila en la gestión de equipo. Ambas acciones quedan en la auditoría. Una sesión cuenta como viva si no está revocada, no ha vencido y tuvo actividad en los últimos 30 minutos. La sincronización entre pestañas solo comparte el aviso de que la sesión terminó, nunca datos. Sigue pendiente el cierre automático al cambiar roles (la acción aún no existe).

**Por qué sesiones de servidor y no fichas autónomas.** Una sesión de servidor se puede revocar al instante: cerrar la sesión significa que el siguiente intento de usarla falla. Con fichas autónomas habría que esperar a que expiren.

**Ejemplo.** A Luis le roban su laptop sin cerrar sesión. Ana, su responsable, entra y cierra todas las sesiones de Luis. Desde ese momento el ladrón no puede hacer nada más. Si Ana además suspende a Luis mientras se aclara el incidente, tampoco podrá volver a entrar.

## 5. Reautenticación

Las acciones más sensibles piden haber verificado un factor **en los últimos 5 minutos**. La lista de acciones está en [`permissions-and-sharing.md`](permissions-and-sharing.md): revelar contraseñas, exportar el segundo factor, cambiar rango o roles, acceso de emergencia, transferir la Raíz y gestionar aplicaciones de inicio de sesión único.

- Con passkey, es un toque en el dispositivo.
- Con aplicación autenticadora, es un código.
- Una vez verificada, durante los siguientes 5 minutos no se le vuelve a pedir.

**Estado hoy.** Funciona con el código de la aplicación autenticadora. Cuando una acción exige reautenticación y la persona no la tiene vigente, el sistema la niega, registra la negación y la interfaz abre un diálogo para introducir el código; tras verificarlo, la acción se reintenta. La reautenticación con passkey o con un código de recuperación no está disponible: solo se acepta el código de la aplicación autenticadora. El flujo completo (cambiar un rango, confirmar la identidad, rechazo de un código incorrecto y éxito con el correcto) ya se prueba en un navegador real. Las acciones sensibles de la bóveda (revelar, exportar) llegan con la fase 1b; hoy el motor ya exige la reautenticación para las acciones de su catálogo que la requieren.

## 6. Protección contra ataques

| Medida | Qué hace |
| --- | --- |
| Límite de intentos | Se limitan los intentos por correo en el ingreso y por usuario en el segundo factor, y por dirección de red en las pantallas de acceso e invitación (60 peticiones por minuto) |
| Retraso y bloqueo temporal | Desde el tercer fallo hay un retraso creciente entre intentos (1, 2, 4 segundos, hasta 64) y, tras 10 intentos fallidos, un bloqueo de 15 minutos. El bloqueo **no es permanente**: así nadie puede dejar fuera a otra persona de forma maliciosa. Pasados 15 minutos sin intentos, el contador se reinicia, y un ingreso correcto también lo reinicia. Valores asumidos por la implementación (ver [preguntas abiertas](#10-preguntas-abiertas)) |
| Mensajes idénticos | El error es el mismo si el usuario no existe o si la contraseña es incorrecta, y los tiempos de respuesta son equivalentes. Así no se puede descubrir qué correos existen |
| Avisos por correo | Se avisa de un ingreso desde un dispositivo nuevo y de cambios de contraseña o de factores. **Pendiente**: hoy el sistema solo envía (en desarrollo, registra) la invitación |

**Estado hoy.** El retraso, el bloqueo y los mensajes idénticos funcionan, y cada intento se cuenta y se decide en una sola operación, para que una ráfaga de intentos simultáneos no pueda colarse (ver [ADR 0026](../adr/0026-atomic-failed-attempt-counting.md)). Limitación importante: los contadores y el límite por dirección viven en la memoria de cada instancia del servidor. Con varias instancias, cada una cuenta por separado y un reinicio borra los contadores. Hasta incorporar el almacén compartido de contadores, el sistema debe operar con una sola instancia.

## 7. Recuperación de acceso

| Situación | Qué hace la persona | Quién interviene | Exigencias |
| --- | --- | --- | --- |
| Perdió su passkey o su aplicación autenticadora, pero conserva sus códigos de recuperación | Usa un código de recuperación y registra un nuevo factor | Nadie más (autoservicio) | Se notifica a la persona y a su responsable |
| Perdió todos sus factores y no tiene códigos | Pide ayuda | Su responsable o la Raíz restablece sus factores | Reautenticación y motivo escrito de quien restablece |
| Es la Raíz y perdió todos sus factores | Usa los códigos de emergencia custodiados | Las dos personas custodias | Alerta a todos los Administradores y evento crítico (ver [`actors-and-hierarchy.md`](actors-and-hierarchy.md)) |

**Estado hoy.** Los códigos de emergencia de la Raíz siguen en decisión abierta: el plan no define qué otorga usar uno, en qué se distingue de un código de recuperación ni quién los custodia, y hoy tampoco existe una pantalla para registrar un segundo factor nuevo tras entrar con un código. Solo funciona el primer caso, parcialmente: el código de recuperación permite completar el ingreso, pero todavía no hay pantalla para registrar un nuevo factor después. El restablecimiento por el responsable o la Raíz, la nueva invitación de configuración y los códigos de emergencia de la Raíz **no están implementados**. Mientras tanto, una persona que pierde todos sus factores y sus códigos, y en particular la Raíz, no tiene un camino de recuperación en el sistema.

Cuando un responsable restablece los factores de alguien, esa persona recibe una **nueva invitación de configuración** y **conserva sus comparticiones**. No empieza de cero.

**Ejemplo.** Sofía pierde su teléfono, que tenía su aplicación autenticadora, y no tiene sus códigos de recuperación. Luis, su responsable, se reautentica, escribe "Sofía perdió su teléfono; verificada por videollamada" y restablece sus factores. Sofía recibe una nueva invitación de configuración, registra un nuevo factor y vuelve a ver las cuentas que ya tenía compartidas.

## 8. Inicio de sesión con proveedores externos

No se usa en la primera versión. El sistema solo deja preparado el punto de conexión para que, si la organización adopta Google Workspace o Microsoft 365, se pueda usar como fuente de inicio de sesión más adelante.

## 9. Reglas numeradas

| N.º | Regla |
| --- | --- |
| AU-1 | Todas las altas son por invitación; el enlace es de un solo uso y dura 72 horas |
| AU-2 | Quien invita nunca conoce la contraseña; reenviar una invitación invalida la anterior |
| AU-3 | La contraseña tiene al menos 12 caracteres, sin reglas de composición, y se rechazan las comunes y las débiles |
| AU-4 | El segundo factor es obligatorio antes de la primera entrada: passkey (preferida) o aplicación autenticadora |
| AU-5 | No se usan mensajes de texto ni correo como segundo factor del sistema |
| AU-6 | Al activar el segundo factor se entregan 10 códigos de recuperación de un solo uso, que se muestran una vez |
| AU-7 | Usar un código de recuperación avisa a la persona y a su responsable |
| AU-8 | Las sesiones caducan a los 30 minutos de inactividad y a las 12 horas absolutas (configurables) |
| AU-9 | Desactivar, suspender, cambiar el rango o los roles cierra las sesiones de la persona en el acto |
| AU-10 | Cada persona ve y cierra sus sesiones; su responsable puede cerrarlas todas |
| AU-11 | Las acciones sensibles exigen haber verificado un factor en los últimos 5 minutos |
| AU-12 | Los errores de ingreso no revelan si el usuario existe; el bloqueo por fallos es temporal |
| AU-13 | Sin factores y sin códigos, solo el responsable (o la Raíz) restablece los factores, con reautenticación y motivo; las comparticiones se conservan |
| AU-14 | La Raíz sin factores se recupera con los códigos de emergencia custodiados |

**Estado de las reglas en la fase 1a.**

| Estado | Reglas |
| --- | --- |
| Se cumplen hoy | AU-1, AU-2, AU-3, AU-6, AU-8, AU-10, AU-11, AU-12 |
| Se cumplen parcialmente | AU-4 (solo aplicación autenticadora, sin passkeys), AU-9 (suspender, desactivar y cambiar el rango cierran las sesiones; falta el cambio de roles) |
| Se cumple la parte que ya existe | AU-5 (no se usan mensajes de texto ni correo como segundo factor) |
| Pendientes | AU-7 (el uso queda auditado, falta el aviso), AU-13, AU-14 |

## 10. Preguntas abiertas

| N.º | Pregunta | Por qué importa |
| --- | --- | --- |
| 1 | Si se exigirán passkeys a la Raíz y a los Administradores desde el inicio | El plan lo recomienda, pero sigue como decisión pendiente del equipo. Hoy las passkeys no están implementadas |
| 2 | Cuánto dura el bloqueo temporal y cuántos fallos lo activan | El plan fija el principio, no los valores. **La implementación asumió:** retraso creciente desde el tercer fallo (de 1 a 64 segundos) y bloqueo temporal de 15 minutos tras 10 intentos fallidos, contado por correo en el ingreso y por usuario en el segundo factor. Pendiente de confirmar con el negocio |
| 3 | Qué se considera un "dispositivo nuevo" para enviar el aviso por correo | Define cuántos avisos recibirá una persona |
| 4 | Si el cambio de contraseña debe exigir reautenticación y avisar por correo | El plan lo menciona como motivo de aviso, no como acción detallada. **La implementación asumió** que basta con demostrar la contraseña actual; el aviso por correo sigue pendiente |
| 5 | Si los códigos de recuperación se pueden regenerar y qué pasa con los anteriores | El plan los entrega una vez y no describe su renovación |
| 6 | Quién puede cerrar las sesiones de un Administrador: su responsable es la Raíz, pero no se explicita | Aplica la misma regla de responsables, a confirmar |
| 7 | Con qué contraseña nace la Raíz y cuándo debe cambiarla | **La implementación asumió:** la Raíz nace en estado "invitada" con una contraseña inicial aleatoria que genera el comando de alta, se muestra una sola vez a operaciones y se debe cambiar en el primer ingreso, antes de registrar el segundo factor. El alta queda en la auditoría. Falta decidir por qué canal operaciones entrega esa contraseña a la Raíz |
| 8 | Si la reautenticación debe admitir también los códigos de recuperación | Hoy solo admite el código de la aplicación autenticadora |
