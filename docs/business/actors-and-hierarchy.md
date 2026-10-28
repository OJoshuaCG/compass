# Actores y jerarquía

**Fuente en el plan:** "Actores y jerarquía: reglas formales" (incluye "Regla de gestión", "Reglas numeradas", "Gestionar personas no da acceso a secretos" y "Grupos"), "Decisiones cerradas (ADR)" (decisiones 007, 008, 009 y 010) y "Autenticación del propio sistema" (recuperación de acceso).

Este documento explica quién existe en la organización, quién crea a quién, quién gestiona a quién y qué pasa cuando alguien cambia de rango, de responsable o deja la empresa. Los personajes de los ejemplos están en el [glosario](README.md#personajes-de-los-ejemplos).

## Qué funciona hoy (fase 1a)

| Tema | Estado hoy |
| --- | --- |
| Los cuatro actores y sus rangos | **Funciona.** Una organización nace con exactamente una Raíz |
| Matriz de creación (quién crea a quién) | **Funciona.** Se aplica al invitar y se valida en el servidor |
| Regla de gestión y subárbol | **Funciona.** Decide quién puede suspender, reactivar, desactivar, cambiar el rango o transferir a una persona |
| Creador y responsable separados | **Funciona.** Al aceptar una invitación, quien invita queda como creador; el responsable es quien invita, o la persona de su subárbol que elija al invitar (con rango superior al del invitado). Si esa persona sale del subárbol antes de que se acepte, la invitación deja de ser válida |
| Transferencia de responsable, cambio de rango, bajas con reasignación | **Funciona.** Hay además una vista de equipo con las personas del subárbol de quien consulta (la Raíz ve a todas) en cualquier estado |
| Recuperación de la Raíz con códigos de emergencia | **Funciona.** Solo quienes custodian los códigos pueden restablecer la Raíz; ningún Administrador puede hacerlo |
| Transferencia de la Raíz | **Pendiente** |
| Estados de una persona | **Funcionan** los cuatro: invitada, activa, suspendida y desactivada. Se puede suspender, reactivar y desactivar; la Raíz nunca se suspende ni se desactiva |
| Directorio visible | **Funciona** para personas activas |
| Grupos | **Pendiente** (llegan con la compartición, fase 1b) |

## Contenido

1. [Los cuatro actores](#1-los-cuatro-actores)
2. [Quién crea a quién](#2-quién-crea-a-quién)
3. [Quién gestiona a quién](#3-quién-gestiona-a-quién)
4. [Reglas numeradas](#4-reglas-numeradas)
5. [Transferencia de responsable](#5-transferencia-de-responsable)
6. [Cambio de rango](#6-cambio-de-rango)
7. [Bajas con reasignación](#7-bajas-con-reasignación)
8. [Transferencia y recuperación de la Raíz](#8-transferencia-y-recuperación-de-la-raíz)
9. [Directorio visible y gestión restringida](#9-directorio-visible-y-gestión-restringida)
10. [Gestionar personas no da acceso a secretos](#10-gestionar-personas-no-da-acceso-a-secretos)
11. [Grupos](#11-grupos)
12. [Preguntas abiertas](#12-preguntas-abiertas)

## 1. Los cuatro actores

Cada actor tiene un **rango** numérico. Un número menor significa más autoridad.

| Actor | Rango | Cuántos puede haber | Crea a | Gestiona a |
| --- | --- | --- | --- | --- |
| Raíz (dueña) | 0 | Exactamente uno por organización | Administradores, Líderes y Operadores | Todos |
| Administrador | 1 | Varios | Líderes y Operadores | Los Líderes y Operadores de su subárbol |
| Líder | 2 | Varios | Operadores | Los Operadores de su subárbol |
| Operador | 3 | Varios | Nadie | Nadie |

**Cómo nace la Raíz.** Una persona de operaciones da de alta la organización con un comando propio, y el alta queda en la auditoría. En ese mismo acto nacen la Raíz, en estado "invitada" y con una contraseña inicial aleatoria que se muestra una sola vez y que la Raíz debe cambiar en su primer ingreso, y las cuatro plantillas de rol del sistema: Raíz (todos los permisos), Administrador (todos salvo la configuración de la organización), Líder y Operador (todo lo que su rango puede tener; ver [`permissions-and-sharing.md`](permissions-and-sharing.md)). La Raíz queda activa cuando completa su segundo factor. Por diseño no puede existir una organización sin Raíz ni con dos.

**Por qué cuatro actores.** El plan resolvió una contradicción de origen: se pedía a la vez "un solo dueño" y "varios del mismo nivel". Con la Raíz única en la cima y varios Administradores por debajo, ambas cosas son ciertas.

## 2. Quién crea a quién

La tabla de la sección anterior es la **única fuente** de las reglas de creación. Se valida en el sistema y no depende de lo que muestre la pantalla.

**Solo la Raíz crea Administradores.** Así ningún actor crea a alguien de su mismo rango, a quien después no podría gestionar (dos personas de rango 1 no se gestionan entre sí).

Toda persona nueva entra por invitación (ver [`authentication.md`](authentication.md)). Quien invita define el rango y los roles iniciales de la persona invitada, y el sistema valida que cumplan la matriz de creación y el principio de no escalamiento (ver [`permissions-and-sharing.md`](permissions-and-sharing.md)). La persona invitada queda bajo la responsabilidad de quien invita.

**Matriz vigente hoy.**

| Quien invita | Puede invitar como |
| --- | --- |
| Raíz | Administrador, Líder u Operador |
| Administrador | Líder u Operador |
| Líder | Operador |
| Operador | Nadie |

Si alguien intenta invitar a un rango que no le corresponde, la invitación se rechaza y el intento queda en la auditoría con su motivo.

## 3. Quién gestiona a quién

### 3.1 Creador y responsable son cosas distintas

| Concepto | Qué es | ¿Puede cambiar? | Para qué sirve |
| --- | --- | --- | --- |
| Creador | Quien dio de alta a la persona | Nunca | Solo auditoría: dejar constancia histórica |
| Responsable | Quien gestiona hoy a la persona | Sí, con las reglas de transferencia | Define la autoridad |

Esta separación evita que una baja deje a personas "huérfanas": si el creador se va, su equipo pasa a otro responsable, y el dato histórico del creador permanece.

### 3.2 La regla de gestión

Un actor puede gestionar a otra persona solo si se cumplen **todas** estas condiciones:

1. El actor está activo.
2. Ambos pertenecen a la misma organización.
3. Son personas distintas (nadie se gestiona a sí mismo).
4. El actor es la Raíz, **o bien** su rango es estrictamente inferior (más autoridad) que el de la otra persona **y** esa persona está dentro de su subárbol de gestión.

El **subárbol de gestión** de un actor son todas las personas cuya cadena de responsables llega hasta él: sus subordinados directos, los subordinados de estos, y así sucesivamente.

Esta regla combina dos ideas que por separado no bastaban: la de nivel ("un Administrador gestiona a cualquier Líder") y la de linaje ("solo gestionas a quien está bajo ti"). Solo por nivel, Pedro gestionaría a Luis aunque Ana lo creó. Solo por linaje, dos personas de igual rango podrían gestionarse entre sí.

### 3.3 Tabla de decisión

| Situación | ¿Puede gestionar? | Motivo |
| --- | --- | --- |
| El actor está suspendido o desactivado | No | Solo actores activos gestionan |
| La otra persona es de otra organización | No | Cada organización está aislada |
| Es la misma persona | No | No hay autogestión; solo edita su propio perfil |
| El actor es la Raíz | Sí | La Raíz gestiona a todos |
| Rango del actor menor y la persona está en su subárbol | Sí | Más autoridad y relación directa o indirecta |
| Rango del actor menor, pero la persona está fuera de su subárbol | No | Falta linaje |
| Mismo rango | No | El rango debe ser estrictamente inferior |
| Rango del actor mayor (menos autoridad) | No | Nadie gestiona hacia arriba |

### 3.4 Ejemplo resuelto

Ana (Administradora) crea a Luis (Líder). Luis crea a Sofía (Operadora). Pedro es otro Administrador creado por la Raíz.

| Actor | Persona | ¿Gestiona? | Por qué |
| --- | --- | --- | --- |
| Ana | Luis | Sí | Rango 1 es menor que 2, y Luis está en su subárbol |
| Ana | Sofía | Sí | Sofía está en el subárbol de Ana a través de Luis |
| Pedro | Luis | No | Luis no está en el subárbol de Pedro, aunque Pedro tenga más autoridad por rango |
| Ana | Pedro | No | Mismo rango |
| Luis | Sofía | Sí | Rango 2 es menor que 3, y Sofía es su subordinada directa |
| Luis | Ana | No | Ana tiene más autoridad |
| Sofía | Cualquiera | No | Los Operadores no gestionan a nadie |
| La Raíz | Ana, Pedro, Luis y Sofía | Sí | La Raíz gestiona a todos |

## 4. Reglas numeradas

| N.º | Regla | Qué significa en la práctica |
| --- | --- | --- |
| AC-1 | **Raíz única.** Solo puede haber una Raíz activa por organización | No existen dos dueños; la transferencia es el único camino para cambiarla |
| AC-2 | **Matriz de creación.** La tabla de la sección 1 es la única fuente | Un Líder no puede invitar a un Administrador, sin importar lo que intente |
| AC-3 | **Creador y responsable separados.** El creador es permanente y solo sirve para auditoría; el responsable define la autoridad y puede cambiar | Ver sección 3.1 |
| AC-4 | **Transferencia de responsable.** La ejecuta quien gestiona a la persona; el nuevo responsable debe ser el propio actor o alguien de su subárbol, con rango estrictamente inferior al de la persona | Ver sección 5 |
| AC-5 | **Cambio de rango.** Solo quien gestiona a la persona; el nuevo rango debe ser mayor que el del actor y respetar la matriz de creación; bajar de rango a quien tiene subordinados se bloquea hasta reasignarlos | Ver sección 6 |
| AC-6 | **Sin autogestión.** Cada persona edita su perfil, contraseña, segundo factor, passkeys y sesiones. Nunca su rango, roles, estado ni responsable | Nadie puede ascenderse ni reactivarse a sí mismo |
| AC-7 | **Bajas con reasignación.** Al desactivar a alguien, sus subordinados directos pasan a su responsable en el mismo momento; si era Administrador, pasan a la Raíz | Ver sección 7 |
| AC-8 | **Nunca se borra a una persona.** Los estados son invitada, activa, suspendida y desactivada | La auditoría conserva su integridad |
| AC-9 | **Transferencia de la Raíz.** La inicia la Raíz hacia un Administrador; ambos se reautentican; hay una espera de 72 horas con aviso a todos los Administradores; es cancelable | Ver sección 8 |
| AC-10 | **Recuperación de la Raíz.** Códigos de emergencia impresos, custodiados por dos personas fuera del sistema; usarlos alerta a todos los Administradores y queda auditado | Ver sección 8 |
| AC-11 | **Directorio visible, gestión restringida.** Todos buscan nombre y correo de los demás; ver detalles, roles y actividad exige poder gestionarlos | Ver sección 9 |

## 5. Transferencia de responsable

**Estado hoy.** Funciona. Si el nuevo responsable no cumple las condiciones de rango, se rechaza con un error propio; si no está activo o no está en el subárbol de quien actúa, la acción se niega sin revelar el motivo. Queda en la auditoría.

Cambiar el responsable de una persona (la "mueve" de rama) exige tres condiciones:

1. Quien lo hace gestiona a esa persona.
2. El nuevo responsable es el propio actor o alguien de su subárbol.
3. El nuevo responsable tiene un rango estrictamente inferior (más autoridad) al de la persona transferida.

**Ejemplo permitido.** Ana quiere ser ella misma la responsable de Sofía, en lugar de Luis. Ana gestiona a Sofía, el nuevo responsable es la propia Ana y su rango (1) es inferior al de Sofía (3). Se permite.

**Ejemplo rechazado.** Ana intenta pasar a Sofía al equipo de Pedro. Pedro no está en el subárbol de Ana y no es ella misma. Se rechaza.

**Ejemplo con la Raíz.** Como todas las cadenas de responsables terminan en la Raíz, todas las personas están en su subárbol. Por eso la Raíz sí puede pasar a Luis del equipo de Ana al de Pedro.

## 6. Cambio de rango

**Estado hoy.** Funciona. Exige reautenticación reciente y que el nuevo rango tenga menos autoridad que el de su responsable actual; si la persona tiene subordinados, se bloquea al bajarla de rango. Se cierran sus sesiones y la acción queda en la auditoría con el rango anterior y el nuevo. La Raíz nunca cambia de rango.

Solo lo hace quien gestiona a la persona, y exige reautenticación (ver [`permissions-and-sharing.md`](permissions-and-sharing.md)). Además:

- El nuevo rango debe ser **mayor** (menos autoridad) que el del actor que lo ejecuta.
- El nuevo rango debe respetar la matriz de creación del actor: un Administrador puede dejar a alguien como Líder u Operador, pero no puede nombrar Administradores.
- Si la persona tiene subordinados, **no se le puede bajar de rango** hasta reasignarlos.
- Al cambiar el rango, se recalculan sus permisos (se recortan los que superen el techo del nuevo rango) y se cierran sus sesiones en el acto.

**Ejemplo.** Ana quiere dejar a Luis como Operador. Luis tiene a Sofía como subordinada, así que se bloquea. Ana primero pasa a Sofía a su propio equipo (sección 5) y después baja el rango de Luis. Los permisos de Luis que solo caben en el rango de Líder o superior se retiran automáticamente.

## 7. Bajas con reasignación

**Estado hoy.** Funcionan la suspensión, la reactivación y la desactivación. Solo suspende quien gestiona a una persona activa, y solo reactiva quien gestiona a una persona suspendida; en otro estado la acción se rechaza. Suspender o desactivar cierra todas las sesiones de la persona en la misma operación. Desactivar además pasa a sus subordinados activos a su propio responsable y revoca las invitaciones pendientes que dejó; la auditoría registra cuántos subordinados se reasignaron. La Raíz nunca se suspende ni se desactiva. Quien gestiona a una persona también puede cerrar todas sus sesiones sin suspenderla ni desactivarla, con el permiso de desactivar y respetando la jerarquía; la Raíz queda protegida y la acción se audita. Siguen pendientes el retiro de comparticiones y la rotación de secretos, que llegan con la bóveda y la gobernanza.

Desactivar a una persona **no la borra**. En el mismo momento:

1. Sus subordinados directos pasan al responsable de la persona dada de baja.
2. Si era Administrador, sus subordinados pasan a la Raíz.
3. Sus sesiones se cierran.
4. Se retiran sus comparticiones directas y se le saca de todos los grupos.
5. Se calcula qué secretos conoció y se crean tareas de rotación (ver [`governance.md`](governance.md)).

**Ejemplo.** Ana desactiva a Luis. Sofía, que dependía de Luis, pasa de inmediato al equipo de Ana. Si en cambio la Raíz desactivara a Ana, Luis pasaría a la Raíz y Sofía seguiría con Luis.

El estado de la persona queda como desactivada. Su historia (quién la creó, qué hizo) se conserva.

## 8. Transferencia y recuperación de la Raíz

### 8.1 Transferencia planeada

Es el camino normal para cambiar al dueño de la organización (por ejemplo, cuando la Raíz actual deja el cargo).

| Paso | Qué ocurre |
| --- | --- |
| 1 | La Raíz elige a un Administrador como nuevo dueño |
| 2 | Ambos, la Raíz actual y el Administrador elegido, se reautentican |
| 3 | Comienza una espera de **72 horas**; se avisa a todos los Administradores |
| 4 | Durante la espera, la transferencia se puede cancelar |
| 5 | Al terminar la espera, el Administrador pasa a ser la Raíz; la Raíz anterior queda como Administrador gestionado por la nueva |

**Por qué la espera.** Da tiempo a detectar una transferencia no deseada, por ejemplo si la cuenta de la Raíz fue tomada por otra persona. El aviso a todos los Administradores hace que no pase desapercibida.

### 8.2 Recuperación cuando la Raíz pierde el acceso

Al crear la organización se generan **códigos de emergencia** de la Raíz. Se imprimen y los custodian **dos personas, fuera del sistema**. Usar uno de estos códigos:

- Avisa a todos los Administradores.
- Queda registrado en la auditoría como evento crítico.

Es la última salida para que la organización no quede sin dueña. Si no existiera, el riesgo es que nadie pueda gestionar a los Administradores. Los procedimientos operativos están en [`runbooks/transfer-root.md`](../runbooks/transfer-root.md) y, para usar un código, en [`runbooks/use-emergency-code.md`](../runbooks/use-emergency-code.md).

**Estado hoy.** Los códigos de emergencia **funcionan**; la transferencia planeada de la Raíz (sección 8.1) sigue **pendiente**. Al crear la organización se generan ocho códigos de un solo uso, que se imprimen una sola vez junto a la contraseña inicial, con la instrucción de imprimirlos y entregarlos a las dos personas custodias. Usar uno exige antes la contraseña de la Raíz; no la sustituye. Al usarlo, el segundo factor de la Raíz se restablece y ella debe registrar uno nuevo; se cierran sus demás sesiones, queda un evento crítico en la auditoría y se avisa por correo a todos los Administradores activos. Si el aviso falla o no hay Administradores a quienes avisar, eso también queda registrado. Los códigos que no se usaron siguen vigentes. Si la Raíz olvida su contraseña y además pierde sus factores, operaciones la recupera solo si las dos personas custodias aportan cada una un código de emergencia de su propio grupo (cuatro códigos por persona): un solo custodio, aunque conserve todos sus papeles, no puede. La recuperación entrega una contraseña de un solo uso y ocho códigos de emergencia nuevos, invalida los anteriores, queda como evento crítico y avisa a los Administradores. No cubre la pérdida total de los códigos ni las organizaciones creadas antes de que los códigos tuvieran custodio.

**Decisión del dueño (2026-10-27).** Solo las personas que custodian los códigos pueden restablecer la Raíz. Ningún Administrador puede restablecerla: los Administradores únicamente reciben la alerta. La razón es que un Administrador capaz de restablecer la Raíz sería un camino para tomar la cuenta de mayor privilegio.

## 9. Directorio visible y gestión restringida

Para poder compartir cuentas, cualquier persona activa debe poder encontrar a otra. Por eso hay dos niveles de visibilidad:

| Qué se quiere ver | ¿Quién puede? |
| --- | --- |
| Nombre y correo de cualquier persona de la organización | Cualquier persona activa |
| Detalles, roles y actividad de una persona | Solo quien puede gestionarla |

**Estado hoy.** El directorio funciona. Cualquier persona activa puede buscar por nombre o por correo, ordenar la lista y avanzarla por páginas. Solo aparecen personas activas (las invitadas que aún no completan su alta, las suspendidas y las desactivadas no se listan) y por cada una se muestran únicamente nombre, correo y rango. Los detalles, roles y actividad de una persona todavía no tienen pantalla.

**Ejemplo.** Sofía quiere compartir una cuenta con un compañero de otro equipo. Busca su nombre en el directorio y lo encuentra, pero no ve sus roles ni su actividad. En cambio Luis sí ve los roles y la actividad de Sofía, porque la gestiona.

## 10. Gestionar personas no da acceso a secretos

Esta es una de las reglas más importantes del producto. **Ningún rango concede acceso automático a una credencial.** Ser Administrador no permite abrir las cuentas del equipo; el acceso a un secreto solo existe por una compartición explícita y auditada (ver [`permissions-and-sharing.md`](permissions-and-sharing.md)).

Hay dos excepciones controladas, para que la Raíz conserve el control sin acceso silencioso:

| Mecanismo | Qué permite | Quién | Condiciones |
| --- | --- | --- | --- |
| Acceso de emergencia | Concederse acceso VIEW a cualquier cuenta | La Raíz y los Administradores que tengan el permiso correspondiente | Motivo escrito, reautenticación, dura 1 hora, avisa a los gestores de la cuenta, queda como evento crítico |
| Inventario de cuentas | Ver los datos descriptivos (nunca los secretos) de todas las cuentas | La Raíz y los Administradores con el permiso de inventario | Solo metadatos |

**Ejemplo.** Pedro, Administrador, necesita entrar a una cuenta que gestiona Luis porque este no responde y hay una urgencia. Pedro no puede gestionar a Luis ni tiene acceso a la cuenta. Si tiene el permiso de acceso de emergencia, solicita el acceso con un motivo y se reautentica. Por 1 hora tiene acceso VIEW; Luis y los demás gestores de la cuenta reciben aviso, y la Raíz ve el evento crítico.

## 11. Grupos

Un grupo es un conjunto de personas al que se le pueden compartir cuentas, para no hacerlo una por una.

| Regla | Detalle |
| --- | --- |
| Pertenencia | Un grupo pertenece a la organización |
| Quién lo crea | La Raíz, los Administradores o los Líderes. Quien lo crea queda como gestor |
| Papeles | **Gestor** (de rango 0 a 2; puede haber varios) y **miembro** (de cualquier rango) |
| Membresías múltiples | Un Operador puede estar en varios grupos |
| Sin anidamiento | No hay grupos dentro de grupos en la primera versión |
| Agregar y quitar miembros | Un gestor solo agrega o quita a personas que él mismo gestiona |
| Sin autoridad por pertenencia | Estar en un grupo no da autoridad sobre las demás personas del grupo |
| Compartir con un grupo | Un gestor solo comparte con el grupo cuentas sobre las que tiene acceso MANAGE |
| Sin aislamiento entre grupos | Los grupos no son organizaciones distintas: comparten catálogo y directorio |

**Ejemplo.** Luis crea el grupo "Redes Marca MX" y queda como su gestor. Agrega a Sofía, a quien gestiona. Intenta agregar a Pedro: se rechaza, porque Luis no gestiona a Pedro. Luis tiene MANAGE sobre la cuenta de Instagram de la marca y la comparte con el grupo con nivel USE: Sofía puede usar el segundo factor de esa cuenta, sin ver la contraseña.

## 12. Preguntas abiertas

El plan no define estos puntos. Deben resolverse antes de implementar la parte afectada.

| N.º | Pregunta | Por qué importa |
| --- | --- | --- |
| 1 | Si una persona suspendida puede volver a activarse, quién lo hace y cómo | El plan lista los estados, pero solo detalla la baja (desactivación). **La implementación asumió** que quien gestiona a la persona puede reactivarla |
| 2 | Si una persona desactivada puede reactivarse | Afecta a la reasignación y a las tareas de rotación ya creadas |
| 3 | Tras una transferencia de la Raíz, qué pasa con los Administradores que dependían de la Raíz anterior y con el responsable del nuevo dueño | El plan solo dice que la Raíz anterior queda como Administradora gestionada por la nueva |
| 4 | Quién puede cancelar una transferencia de la Raíz durante las 72 horas | El plan indica que es cancelable, sin precisar por quién |
| 5 | Quiénes son las dos personas custodias y si hacen falta juntas para usar un código de emergencia | Se implementaron ocho códigos de un solo uso y se decidió que ningún Administrador puede restablecer la Raíz. La identidad de los custodios sigue como decisión pendiente |
| 6 | Quién puede nombrar a otro gestor de un grupo, y quién archiva un grupo | El plan define los papeles, pero no esas acciones |
| 7 | Cómo se interpreta "bajar de rango": este documento lo lee como pasar a un rango con menos autoridad (número mayor) | Es la lectura coherente con el resto de la regla, pero conviene confirmarla |
| 8 | Qué pasa con las cuentas cuyos únicos gestores (MANAGE) son personas dadas de baja | La baja retira comparticiones directas; el plan no dice quién queda a cargo de esas cuentas |
| 9 | Cómo nace la Raíz y con qué estado | **La implementación asumió:** la Raíz nace en estado "invitada", con una contraseña inicial aleatoria que se muestra una sola vez a la persona de operaciones, y pasa a activa al registrar su segundo factor, después de cambiar esa contraseña en su primer ingreso. El alta de la organización queda en la auditoría. Falta confirmar cómo se entrega esa contraseña a la Raíz |
| 10 | Si quien invita puede elegir un responsable distinto de sí mismo | El plan dice que quien invita define el responsable. **La implementación asumió** que el responsable de la persona invitada es siempre quien la invita, que es el caso que la matriz de creación permite sin ambigüedad |
| 11 | Si el directorio debe mostrar el rango de cada persona | El plan solo menciona nombre y correo. **La implementación muestra además el rango**; falta confirmar que esa información deba ser visible para cualquier persona activa |
