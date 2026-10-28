# Permisos y compartición

**Fuente en el plan:** "Modelo de autorización" (incluye "Catálogo de permisos", "Roles", "Niveles de compartición" y "Motor de decisión"), "Actores y jerarquía: reglas formales" (acceso de emergencia), "Gobernanza: auditoría, bajas, salud y acceso temporal" y "Decisiones cerradas (ADR)" (decisiones 010, 011 y 012).

Este documento explica cómo el sistema decide si una persona puede hacer algo: tres ejes que se evalúan juntos, un catálogo de permisos con techos por rango, roles, niveles de compartición y las acciones que exigen volver a identificarse o escribir un motivo. Los personajes de los ejemplos están en el [glosario](README.md#personajes-de-los-ejemplos).

## Qué funciona hoy (fase 1a)

| Tema | Estado hoy |
| --- | --- |
| Catálogo de 27 permisos con sus techos de rango | **Implementado y probado.** Es una lista fija; no se crean permisos desde la pantalla |
| Plantillas de rol del sistema (Raíz, Administrador, Líder, Operador) | **Funcionan.** Se crean con cada organización. Los conjuntos de Líder y Operador son una decisión asumida (ver [preguntas abiertas](#11-preguntas-abiertas)) |
| Permisos efectivos (unión de roles recortada por el techo) | **Funciona** |
| No escalamiento al invitar | **Funciona.** Quien invita no puede otorgar roles con permisos que no tiene ni que superen el techo del rango invitado |
| Motor de decisión (organización, sesión, permiso, jerarquía, contexto) | **Funciona.** El paso de compartición llega con la bóveda (fase 1b) |
| Reautenticación, motivo escrito y auditoría crítica como obligaciones | **El motor las exige.** La reautenticación está disponible con la aplicación autenticadora; el motivo escrito y la auditoría crítica se aplicarán cuando existan las acciones que los usan (revelar, exportar, acceso de emergencia) |
| Auditoría de negaciones | **Funciona.** Toda negación se registra con su código de motivo, aunque la acción se revierta (ver [ADR 0022](../adr/0022-audit-of-denials-in-independent-transaction.md)) |
| Roles personalizados (crear, editar, archivar, elegir al invitar) | **Funciona.** Un rol ya creado se edita desde su pantalla (nombre y permisos) |
| Niveles de compartición, vencimientos, revocación, acceso de emergencia | **Pendiente** (fase 1b y 1c) |

## Contenido

1. [Los tres ejes de la autorización](#1-los-tres-ejes-de-la-autorización)
2. [Catálogo de permisos](#2-catálogo-de-permisos)
3. [Roles](#3-roles)
4. [No escalamiento](#4-no-escalamiento)
5. [Niveles de compartición](#5-niveles-de-compartición)
6. [Compartir, vencer y revocar](#6-compartir-vencer-y-revocar)
7. [Cómo decide el sistema, paso a paso](#7-cómo-decide-el-sistema-paso-a-paso)
8. [Acciones que exigen reautenticación y motivo](#8-acciones-que-exigen-reautenticación-y-motivo)
9. [Acceso de emergencia](#9-acceso-de-emergencia)
10. [Reglas numeradas](#10-reglas-numeradas)
11. [Preguntas abiertas](#11-preguntas-abiertas)

## 1. Los tres ejes de la autorización

Toda decisión evalúa tres ejes. Cada uno responde una pregunta distinta y puede crecer por separado.

| Eje | Pregunta que responde | Se define en |
| --- | --- | --- |
| Jerarquía | ¿A quién puedes gestionar? | [`actors-and-hierarchy.md`](actors-and-hierarchy.md) |
| Permisos | ¿Qué acciones puedes realizar? | Secciones 2 a 4 de este documento |
| Alcance (compartición) | ¿Sobre qué recursos puedes hacerlo? | Secciones 5 y 6 de este documento |

Reglas de combinación:

- **Se niega por defecto.** Si ningún eje lo autoriza, no ocurre.
- **Una acción sobre un secreto exige el permiso y el nivel de compartición a la vez.** Ninguno basta solo.
- **Las negaciones también se auditan**, con su motivo. Un patrón de negaciones repetidas es una señal de abuso.

**Ejemplo.** Sofía tiene el nivel VIEW sobre una cuenta (alcance) pero su rol no incluye el permiso de revelar contraseñas. No puede revelarla. Y si tuviera el permiso pero solo el nivel USE sobre esa cuenta, tampoco.

## 2. Catálogo de permisos

Los permisos son una lista fija definida por el producto; no se crean permisos nuevos desde la pantalla. Cada permiso tiene un **techo**: el rango máximo que puede tenerlo. Un Operador (rango 3) nunca recibe un permiso con techo 1.

Cómo leer el techo:

| Techo | Quién puede tenerlo |
| --- | --- |
| 0 | Solo la Raíz |
| 1 | Hasta los Administradores (Raíz y Administradores) |
| 2 | Hasta los Líderes (Raíz, Administradores y Líderes) |
| 3 | Cualquier actor, hasta los Operadores |

> **Nota sobre la columna "Por qué existe".** El plan fija cada permiso, lo que permite y su techo. La explicación de por qué existe es una lectura de negocio derivada de esas reglas; no siempre aparece con esas palabras en el plan.

### 2.1 Organización, roles y catálogo

| Permiso | Qué permite | Techo | Por qué existe |
| --- | --- | --- | --- |
| Configurar la organización | Cambiar la configuración de la organización y transferir la Raíz | 0 | Son decisiones que solo corresponden a la dueña |
| Gestionar roles | Crear y editar roles personalizados | 1 | Define qué pueden hacer otros; es una decisión de administración |
| Gestionar el catálogo de plataformas | Editar las plataformas propias de la organización | 1 | Evita catálogos inconsistentes o duplicados |
| Gestionar aplicaciones de inicio de sesión único | Registrar aplicaciones conectadas (fase 2) | 1 | Una aplicación mal registrada puede abrir accesos indebidos |

### 2.2 Vigilancia

| Permiso | Qué permite | Techo | Por qué existe |
| --- | --- | --- | --- |
| Ver el inventario de cuentas | Ver los datos descriptivos de todas las cuentas, nunca los secretos | 1 | Permite saber qué cuentas existen sin acceder a ellas |
| Acceso de emergencia | Concederse acceso VIEW a cualquier cuenta (ver sección 9) | 1 | Permite actuar en una urgencia sin dejar acceso silencioso |
| Leer toda la auditoría | Consultar todos los eventos de la organización | 1 | Investigar incidentes en toda la organización |
| Leer la auditoría de su ámbito | Consultar la auditoría de su subárbol y de sus recursos | 2 | Que un jefe revise a su equipo sin ver el resto |

### 2.3 Personas y grupos

| Permiso | Qué permite | Techo | Por qué existe |
| --- | --- | --- | --- |
| Invitar usuarios | Invitar según la matriz de creación | 2 | Dar de alta personas; los Operadores no crean a nadie |
| Editar usuarios | Editar perfil y estado de personas que gestiona | 2 | Mantener datos y suspender cuando haga falta |
| Cambiar el rango | Cambiar el rango de personas que gestiona | 1 | Cambia la autoridad; por eso lo limita a Administradores |
| Transferir responsable | Cambiar el responsable de una persona | 2 | Reorganizar equipos |
| Suspender o desactivar usuarios | Suspender o desactivar a personas que gestiona | 2 | Cortar el acceso de alguien que se va o es sospechoso |
| Asignar roles | Asignar roles a personas que gestiona | 2 | Dar capacidades a un equipo |
| Crear grupos | Crear grupos | 2 | Agrupar personas para compartir cuentas |
| Gestionar miembros de grupos | Agregar y quitar miembros en grupos que gestiona | 2 | Mantener los grupos al día |

### 2.4 Cuentas, credenciales y compartición

| Permiso | Qué permite | Techo | Nivel de compartición que exige | Por qué existe |
| --- | --- | --- | --- | --- |
| Crear cuentas | Dar de alta cuentas de plataforma | 3 | (Quien la crea recibe MANAGE) | Que quien trabaja con la cuenta pueda registrarla |
| Editar cuentas | Editar datos descriptivos de una cuenta | 3 | EDIT | Mantener la información correcta |
| Archivar cuentas | Archivar una cuenta | 2 | MANAGE | Es una acción más delicada: revoca todas las comparticiones |
| Crear credenciales | Agregar credenciales a una cuenta | 3 | EDIT | Registrar accesos |
| Cambiar contraseñas y secretos | Registrar nuevas contraseñas y secretos | 3 | EDIT | Mantener los secretos vigentes |
| Revelar contraseñas | Mostrar la contraseña | 3 | VIEW | Es la acción más sensible sobre un secreto |
| Usar códigos de segundo factor | Obtener el código actual | 3 | USE | Permite trabajar sin ver el secreto |
| Exportar el secreto de segundo factor | Mostrar el secreto con el que se generan los códigos | 2 | MANAGE | Es poder llevarse el segundo factor; por eso solo lo tienen hasta los Líderes |
| Compartir y revocar | Compartir una cuenta y retirar comparticiones | 3 | MANAGE | Que quien gestiona una cuenta decida quién la usa |

### 2.5 Gobernanza

| Permiso | Qué permite | Techo | Por qué existe |
| --- | --- | --- | --- |
| Aprobar solicitudes de acceso temporal | Aprobar o negar solicitudes | 2 | Reducir el acceso permanente (ver [`governance.md`](governance.md)) |
| Gestionar tareas de rotación | Asignar y cerrar tareas de rotación | 2 | Que alguien responda por los cambios de contraseña tras una baja |

### 2.6 Lo que no se mezcla

Dos cosas distintas pueden parecer iguales y no lo son:

- **Un permiso** dice qué tipo de acción puedes hacer, en general (por ejemplo, "revelar contraseñas").
- **Un nivel de compartición** dice sobre qué cuenta concreta lo puedes hacer.

## 3. Roles

Un rol es un conjunto de permisos con nombre, para asignarlos juntos.

| Tipo | Qué es | ¿Editable? |
| --- | --- | --- |
| Plantilla del sistema | Raíz (todos los permisos), Administrador (todos salvo configurar la organización), Líder y Operador (con conjuntos por defecto) | No |
| Rol personalizado | Creado por quien tenga el permiso de gestionar roles | Se pueden crear, editar y archivar desde la interfaz y elegir al invitar. Si el rol incluye permisos que quien edita no tiene, la pantalla lo avisa y no deja guardar. Quien edita un rol debe tener todos los permisos que el rol tiene hoy y los que tendrá, porque quienes ya lo tienen los reciben de inmediato |

**Conjuntos que se aplican hoy a Líder y Operador.** El plan solo dice "conjuntos por defecto" sin enumerarlos. La implementación asumió que cada plantilla incluye **todo lo que su rango puede tener**, es decir, todos los permisos cuyo techo alcanza ese rango:

| Plantilla | Qué incluye hoy |
| --- | --- |
| Líder | Los 19 permisos con techo 2 o 3: invitar, editar, transferir y desactivar personas, asignar roles, crear grupos y gestionar sus miembros, todas las acciones de cuentas y credenciales (incluidas archivar y exportar el secreto de segundo factor), compartir, aprobar accesos temporales, gestionar tareas de rotación y leer la auditoría de su ámbito |
| Operador | Los 7 permisos con techo 3: crear y editar cuentas, crear y editar credenciales, revelar contraseñas, usar códigos de segundo factor y compartir y revocar |

Estos permisos solo se vuelven efectivos sobre una cuenta concreta cuando exista la compartición (fase 1b), porque una acción sobre un secreto exige el permiso y el nivel de compartición a la vez.

Reglas:

- Los permisos de un rol personalizado deben ser un **subconjunto de los del que lo crea**.
- Los permisos efectivos de una persona son la **unión de todos sus roles**, recortada por el techo de su rango.
- Si el rango de la persona cambia, el recorte se recalcula.
- **Hoy** la pantalla de roles solo ofrece al crear los permisos que tiene quien lo crea; si se intenta otorgar uno que no tiene, se rechaza. Dos roles no pueden llamarse igual, sin distinguir mayúsculas.
- Las plantillas del sistema no se pueden archivar. Un rol archivado deja de otorgar sus permisos y no se puede usar en invitaciones nuevas.
- Crear y archivar roles queda en la auditoría.

**Ejemplo.** Luis (Líder) tiene un rol que incluye "Cambiar el rango" por un error de configuración. Como el techo de ese permiso es 1 y el rango de Luis es 2, el permiso queda recortado y Luis nunca puede ejercerlo.

## 4. No escalamiento

**Nadie otorga un permiso que no tiene.** Se aplica en dos momentos:

1. Al **crear un rol personalizado**, sus permisos deben ser un subconjunto de los de quien lo crea.
2. Al **asignar un rol** a una persona, se exigen tres cosas a la vez:
   - Quien asigna gestiona a esa persona.
   - Quien asigna tiene todos los permisos del rol.
   - Ningún permiso del rol supera el techo del rango de la persona que lo recibe.

Del mismo modo, **nadie comparte un nivel superior al suyo** sobre una cuenta.

**Por qué existe esta regla.** Sin ella, una persona con pocos permisos podría crear un rol poderoso y asignárselo, o pedirle a un colega que se lo asigne. Es el escalamiento de privilegios, y esta regla lo cierra.

**Ejemplo.** Ana quiere asignarle a Sofía un rol que incluye "Revelar contraseñas" y "Exportar el secreto de segundo factor". Ana gestiona a Sofía y tiene ambos permisos. Pero "Exportar" tiene techo 2 y Sofía es Operadora (rango 3). Se rechaza. Si el rol solo tuviera "Revelar contraseñas" (techo 3), se aceptaría.

## 5. Niveles de compartición

Una compartición otorga a una persona o a un grupo un nivel de acceso sobre una cuenta. Los niveles son acumulativos: cada uno incluye lo del anterior.

| Nivel | Incluye | Qué NO puede hacer |
| --- | --- | --- |
| **USE** | Ver los datos de la cuenta, copiar el usuario, obtener el código de segundo factor y (en el futuro) usar el broker de sesiones | Ver la contraseña |
| **VIEW** | Todo lo de USE, más revelar y copiar la contraseña | Editar |
| **EDIT** | Todo lo de VIEW, más editar la cuenta y cambiar credenciales | Compartir, exportar el secreto de segundo factor, archivar |
| **MANAGE** | Todo lo de EDIT, más compartir, revocar, exportar el secreto de segundo factor y archivar | Nada; es el nivel máximo sobre la cuenta |

**Por qué el nivel USE.** Permite que un Operador trabaje en una plataforma, usando el segundo factor, sin conocer la contraseña. Esto reduce lo que podría filtrarse si esa persona se va o es comprometida.

Si una persona recibe acceso a una cuenta tanto directamente como por uno o más grupos, **vale el nivel más alto** de entre todos.

## 6. Compartir, vencer y revocar

### 6.1 A quién se comparte

A personas o a grupos. Para compartir con un grupo, el gestor del grupo debe tener MANAGE sobre la cuenta. Quien comparte necesita además el permiso de compartir (ver sección 2.3).

### 6.2 Vencimiento

Una compartición puede tener una fecha de vencimiento. El sistema retira las vencidas automáticamente y, además, **ignora cualquier compartición vencida al decidir**, aunque aún no se haya retirado.

### 6.3 Qué pasa al revocar

| Situación | Efecto |
| --- | --- |
| Se revoca una compartición | El acceso se corta de inmediato |
| La persona nunca reveló la contraseña | No se requiere acción adicional |
| La persona **sí** reveló la contraseña antes | Se crea una tarea de rotación para esa credencial (ver [`governance.md`](governance.md)) |
| Se archiva una cuenta | Se revocan todas sus comparticiones; los secretos se conservan cifrados |

**Por qué la tarea de rotación.** Quitar el acceso no borra lo que la persona ya vio. Si reveló la contraseña, sigue conociéndola; la única forma de cerrar ese riesgo es cambiarla.

### 6.4 Ejemplo completo

Luis es MANAGE de la cuenta de Instagram de una marca. Comparte la cuenta con Sofía a nivel VIEW, con vencimiento en una semana, y también con el grupo "Redes Marca MX" a nivel USE. Sofía pertenece al grupo.

- Sofía tiene dos orígenes de acceso: VIEW directo y USE por el grupo. Vale el más alto: VIEW.
- Una semana después vence su compartición directa. A partir de ese momento, Sofía conserva el USE del grupo y deja de poder revelar la contraseña.
- Si Sofía reveló la contraseña durante esa semana, el plan prevé una tarea de rotación al **revocar** tras una revelación y en las bajas. Si el vencimiento automático cuenta como revocación no está definido (ver preguntas abiertas).

## 7. Cómo decide el sistema, paso a paso

Para cada acción, el sistema recorre estos pasos en orden. Al primer fallo, niega y registra el motivo.

| Paso | Qué comprueba | Si falla, motivo de la negación |
| --- | --- | --- |
| 1 | El recurso pertenece a la organización de la persona | Organización distinta |
| 2 | La persona está activa y su sesión es válida | Sesión |
| 3 | El permiso de la acción está entre los permisos efectivos de la persona | Permiso |
| 4 | Si el recurso es una persona: la regla de gestión se cumple | Jerarquía |
| 5 | Si el recurso es de la bóveda: el nivel efectivo de compartición alcanza el nivel requerido | Compartición |
| 6 | Restricciones de contexto: reautenticación reciente, ventana de acceso temporal, límite de uso | Contexto |
| 7 | Se permite, con las obligaciones que correspondan: reautenticar, escribir motivo, auditoría crítica | (Permitido) |

**Estado hoy.** El motor evalúa los pasos 1 a 4, 6 y 7 y se niega por defecto. El paso 5 (compartición) llega con la bóveda. Una persona que todavía está en estado "invitada" no pasa el paso 2, por lo que no puede ejercer permisos hasta completar su alta. Cada negación se audita con su motivo (organización, sesión, permiso, jerarquía o reautenticación requerida), y también se audita la negación de una regla de negocio fuera del motor, como invitar a un rango no permitido o intentar otorgar un rol que supera los permisos de quien invita. La negación queda registrada aunque la acción completa se revierta.

Dos garantías adicionales:

- Los **listados** de la aplicación solo muestran lo que la persona puede ver; el filtro se aplica al consultar, no después.
- El permiso se comprueba en dos puntos: una primera barrera en la entrada y la decisión completa en la lógica de negocio. La primera es una red de seguridad, no la autorización.

## 8. Acciones que exigen reautenticación y motivo

Para las acciones más sensibles, el sistema pide volver a demostrar quién eres, y en algunas, además, escribir una explicación.

| Acción | Reautenticación | Motivo escrito |
| --- | --- | --- |
| Revelar una contraseña | Sí | Sí |
| Exportar el secreto de segundo factor | Sí | Sí |
| Acceso de emergencia | Sí | Sí |
| Cambiar el rango de una persona | Sí | No |
| Cambiar los roles de una persona | Sí | No |
| Transferir la Raíz | Sí | No |
| Gestionar aplicaciones de inicio de sesión único | Sí | No |

**Cómo funciona la reautenticación.** La persona verifica un factor (un toque con passkey o un código de su aplicación autenticadora). Vale **5 minutos**: durante ese tiempo no se le pide de nuevo. Detalles en [`authentication.md`](authentication.md).

**Por qué el motivo escrito.** Deja constancia en la auditoría de por qué se hizo algo tan sensible. Quien revise el registro más tarde entenderá el contexto.

## 9. Acceso de emergencia

Es la salida controlada para urgencias, sin que existan accesos silenciosos.

| Característica | Detalle |
| --- | --- |
| Quién | La Raíz y los Administradores con el permiso de acceso de emergencia |
| Qué concede | Acceso VIEW a cualquier cuenta de la organización |
| Condiciones | Motivo escrito y reautenticación |
| Duración | 1 hora |
| Avisos | Se notifica a los gestores de la cuenta |
| Auditoría | Evento crítico, que avisa en tiempo real a la Raíz y a los gestores del recurso |

Como concede VIEW y no MANAGE, con este acceso **no** se puede exportar el secreto de segundo factor, compartir ni editar: solo ver, incluida la contraseña.

**Ejemplo.** Pedro (Administrador con el permiso) necesita revelar una contraseña de una cuenta que gestiona Luis, quien está de vacaciones. Pedro se reautentica, escribe "Cliente reporta cuenta bloqueada; Luis fuera de oficina" y obtiene VIEW por 1 hora. Luis y los gestores reciben el aviso, y la Raíz ve el evento crítico. Pasada la hora, el acceso termina solo.

## 10. Reglas numeradas

| N.º | Regla |
| --- | --- |
| PE-1 | Toda decisión evalúa jerarquía, permisos y alcance, y se niega por defecto |
| PE-2 | Una acción sobre un secreto exige el permiso y el nivel de compartición a la vez |
| PE-3 | Cada permiso tiene un techo de rango; nadie por debajo de ese techo puede tenerlo |
| PE-4 | Los permisos efectivos son la unión de los roles, recortada por el techo del rango |
| PE-5 | Las plantillas del sistema no se editan; los roles personalizados solo contienen permisos que su creador tiene |
| PE-6 | Al asignar un rol, quien asigna gestiona a la persona, tiene todos los permisos del rol, y el rol no supera el techo de la persona |
| PE-7 | Nadie comparte un nivel superior al suyo |
| PE-8 | Con acceso directo y por grupo a la vez, vale el nivel más alto |
| PE-9 | Una compartición vencida deja de valer aunque aún no se haya retirado |
| PE-10 | Revocar es inmediato; si la persona reveló la contraseña, se crea una tarea de rotación |
| PE-11 | Revelar contraseñas, exportar el secreto de segundo factor y el acceso de emergencia exigen reautenticación y motivo escrito |
| PE-12 | Cambiar rangos o roles, transferir la Raíz y gestionar aplicaciones de inicio de sesión único exigen reautenticación |
| PE-13 | Las negaciones se auditan con su motivo |

## 11. Preguntas abiertas

| N.º | Pregunta | Por qué importa |
| --- | --- | --- |
| 1 | Qué permisos incluye por defecto la plantilla de Líder y la de Operador | El plan indica "conjuntos por defecto" sin enumerarlos. **La implementación asumió** "todo lo que su rango puede tener" (19 permisos para el Líder y 7 para el Operador). Pendiente de confirmar con el negocio: con esa elección, un Operador puede revelar contraseñas y compartir cuentas por defecto (siempre que tenga el nivel de compartición que se exige), y un Líder puede archivar cuentas y exportar el secreto de segundo factor |
| 2 | Si el vencimiento de una compartición que ya tuvo una revelación debe también generar tarea de rotación | El plan solo la prevé al revocar y en las bajas |
| 3 | Si el acceso de emergencia puede renovarse pasada la hora | El plan fija 1 hora, sin hablar de renovación |
| 4 | Cuál es la lista cerrada de eventos que cuentan como "uso" de un secreto en la auditoría ligera (copiar el usuario, código de segundo factor) frente a la auditoría completa | Define el volumen y la utilidad de la auditoría |
| 5 | Cómo se retira o archiva un rol personalizado que ya está asignado a personas | El plan define cómo se crea y se asigna, no cómo se retira. **La implementación asumió** que archivar un rol le quita su efecto en los permisos de quien lo tiene y lo excluye de invitaciones nuevas. Pendiente de confirmar con el negocio |
| 6 | Si una persona que está en estado "invitada" debe poder ejercer algún permiso antes de completar su alta | **La implementación asumió** que no: solo las personas activas ejercen permisos |
