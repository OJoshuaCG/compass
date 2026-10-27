# Lógica de negocio

Este conjunto de documentos explica **qué hace** la plataforma y **por qué** lo hace así, sin código. Está escrito para personas de negocio y de operaciones: quien decide quién puede hacer qué, quien administra al equipo y quien responde a un incidente. No contiene nombres de clases, funciones, tablas, rutas de API ni fragmentos técnicos.

La fuente de verdad es [`plan.md`](../../plan.md). Cada documento indica en su encabezado de qué secciones del plan sale. Si algo aquí contradice al plan, manda el plan. Lo que el plan no define se anota en la sección "Preguntas abiertas" de cada documento, nunca se inventa.

## Cómo leer estos documentos

| Si quieres saber... | Lee |
| --- | --- |
| Para qué existe el producto, qué principios sigue y qué no hace | [`overview.md`](overview.md) |
| Quién es quién, quién crea y gestiona a quién, qué pasa con una baja | [`actors-and-hierarchy.md`](actors-and-hierarchy.md) |
| Quién puede hacer qué, cómo se comparte una cuenta, qué exige motivo o reautenticación | [`permissions-and-sharing.md`](permissions-and-sharing.md) |
| Cómo se guardan y usan cuentas, credenciales y secretos | [`vault.md`](vault.md) |
| Cómo se registran y usan los códigos de segundo factor de las plataformas | [`two-factor.md`](two-factor.md) |
| Cómo entran las personas al sistema y cómo se protegen sus sesiones | [`authentication.md`](authentication.md) |
| Auditoría, bajas con rotación, salud de credenciales y acceso temporal | [`governance.md`](governance.md) |
| Qué entrega cada fase, qué está hecho y qué decisiones siguen abiertas | [`roadmap-and-status.md`](roadmap-and-status.md) |

Orden sugerido para quien llega por primera vez: resumen general, actores, permisos y compartición, bóveda, segundo factor, autenticación, gobernanza y, al final, hoja de ruta.

## Personajes de los ejemplos

Todos los documentos usan los mismos personajes para que los ejemplos se puedan seguir de un texto a otro.

| Persona | Papel | Detalle |
| --- | --- | --- |
| Ana | Administradora | Creó a Luis |
| Pedro | Administrador | Mismo rango que Ana, pero en otra rama de la organización |
| Luis | Líder | Creado por Ana; por eso Ana es su responsable |
| Sofía | Operadora | Creada por Luis; aparece cuando hace falta un ejemplo de Operador |
| La Raíz | Dueña de la organización | Una sola persona; se menciona sin nombre propio |

## Glosario de negocio

### Personas y jerarquía

| Término | Significado |
| --- | --- |
| Organización | La empresa que usa el sistema. Hoy hay una sola, pero el sistema nace preparado para varias, completamente aisladas entre sí |
| Raíz | La dueña de la organización. Es única, tiene rango 0 y gestiona a todos |
| Administrador | Rango 1. Crea Líderes y Operadores y gestiona su propia rama |
| Líder | Rango 2. Crea Operadores y gestiona a los Operadores de su rama |
| Operador | Rango 3. Usa la bóveda en el día a día; no crea ni gestiona a nadie |
| Rango | Número del 0 al 3 asociado a cada actor. Un número menor significa más autoridad |
| Creador | Quien dio de alta a una persona. Es un dato histórico que nunca cambia y sirve para auditoría |
| Responsable | Quien gestiona hoy a una persona. Puede cambiar (por ejemplo, en una baja) y define la autoridad |
| Subárbol de gestión | Conjunto de personas cuya cadena de responsables llega hasta un actor determinado |
| Estados de una persona | Invitada, activa, suspendida o desactivada. Una persona nunca se borra |
| Directorio | Lista de nombres y correos que cualquier persona activa puede consultar para compartir cuentas |
| Grupo | Conjunto de personas al que se le comparten cuentas. Tiene gestores y miembros |
| Gestor de grupo | Persona de rango 0 a 2 que administra los miembros de un grupo |

### Permisos y compartición

| Término | Significado |
| --- | --- |
| Permiso | Una acción concreta que una persona puede realizar (por ejemplo, invitar usuarios o revelar contraseñas) |
| Rol | Conjunto de permisos con nombre. Hay plantillas del sistema y roles personalizados |
| Techo de un permiso | Rango máximo que puede tener ese permiso. Un Operador nunca recibe un permiso con techo superior a su rango |
| No escalamiento | Regla por la que nadie otorga un permiso que no tiene |
| Compartición | Autorización explícita para que una persona o un grupo use una cuenta con un nivel determinado |
| USE | Nivel mínimo: ver datos de la cuenta, copiar el usuario y obtener el código de segundo factor, sin ver la contraseña |
| VIEW | Incluye USE y permite revelar y copiar la contraseña |
| EDIT | Incluye VIEW y permite editar la cuenta y cambiar credenciales |
| MANAGE | Incluye EDIT y permite compartir, revocar, exportar el secreto de segundo factor y archivar |
| Vencimiento | Fecha y hora en que una compartición deja de valer sola |
| Reautenticación | Volver a demostrar quién eres con un segundo factor antes de una acción sensible. Vale 5 minutos |
| Motivo escrito | Explicación que la persona debe escribir antes de ciertas acciones sensibles. Queda en la auditoría |
| Acceso de emergencia | Acceso de lectura (VIEW) y por 1 hora que la Raíz o ciertos Administradores se conceden a cualquier cuenta, con motivo, reautenticación y alerta |
| Acceso temporal | Acceso por tiempo limitado que una persona solicita y otra aprueba |
| Inventario de cuentas | Vista de los datos descriptivos de todas las cuentas de la organización, nunca de sus secretos |

### Bóveda y segundo factor

| Término | Significado |
| --- | --- |
| Plataforma | El servicio externo donde existe una cuenta (por ejemplo, Instagram o Gmail) |
| Cuenta | Una cuenta concreta dentro de una plataforma (por ejemplo, la cuenta de la marca en Instagram) |
| Credencial | Un acceso a esa cuenta. Una cuenta puede tener varias |
| Secreto | Dato confidencial de una credencial: usuario, contraseña, clave de segundo factor, códigos de recuperación o notas |
| Versión de un secreto | Cada cambio de un secreto crea una versión nueva; las anteriores se conservan 30 días |
| Revelar | Mostrar la contraseña en pantalla. Es una acción auditada, con motivo y reautenticación |
| Segundo factor de la plataforma (2FA) | Código de un solo uso de 6 u 8 dígitos que cambia cada 30 o 60 segundos y que la plataforma pide además de la contraseña |
| Confirmación del 2FA | Paso obligatorio que comprueba que la plataforma aceptó el código antes de dar el registro por bueno |
| Entrega por celular (handoff) | Método de registro del 2FA que usa la cámara del teléfono para leer el código QR de la plataforma |
| Alias de correo de la cuenta | Dirección de correo propia y única que se asigna a cada cuenta de plataforma para recibir sus avisos y, en el futuro, sus códigos |
| Catálogo de plataformas | Lista de plataformas disponibles, con una opción "Personalizada" para cualquier otro sitio |

### Autenticación del propio sistema

| Término | Significado |
| --- | --- |
| Invitación | Única forma de dar de alta a una persona. Es un enlace de un solo uso con vigencia de 72 horas |
| Segundo factor del sistema | Passkey o código de aplicación autenticadora. Es obligatorio desde el primer ingreso |
| Passkey | Método de acceso con el dispositivo (huella, rostro o llave de seguridad) resistente a la suplantación. Es el método preferido |
| Códigos de recuperación | Diez códigos de un solo uso que se entregan al activar el segundo factor, como último recurso |
| Códigos de emergencia de la Raíz | Códigos impresos y custodiados fuera del sistema por dos personas, para recuperar a la Raíz |
| Sesión | Periodo en que una persona permanece autenticada. Caduca por inactividad y por antigüedad |

### Gobernanza

| Término | Significado |
| --- | --- |
| Auditoría | Registro de quién hizo qué y cuándo. No se puede alterar y nunca contiene secretos |
| Evento crítico | Evento de auditoría de especial gravedad que avisa en tiempo real a la Raíz y a los gestores del recurso |
| Baja | Desactivación de una persona. Dispara reasignación de su equipo y rotación de lo que conoció |
| Exposición | Conjunto de contraseñas que una persona reveló y claves de segundo factor que exportó en los últimos 180 días |
| Rotación | Cambiar una contraseña o clave que pudo quedar conocida por alguien que ya no debe tenerla |
| Tarea de rotación | Pendiente que el sistema crea para recordar y registrar una rotación |
| Salud de una credencial | Puntaje y señales de riesgo: contraseña débil o repetida, antigua, sin segundo factor, expuesta, entre otras |
| Acceso temporal (JIT) | Ver "Acceso temporal" en la tabla de permisos y compartición |

## Convenciones de estos documentos

- Las reglas están numeradas con un prefijo por documento (por ejemplo, AC-3 es la regla 3 de actores y jerarquía) para poder citarlas.
- Las tablas de decisión se leen de izquierda a derecha: situación, resultado y motivo.
- Cuando un valor es configurable (tiempos, límites), se indica el valor por defecto que fija el plan.
- Las fases futuras se describen solo en [`roadmap-and-status.md`](roadmap-and-status.md); el resto de los documentos describe el producto de la fase 1.

## Estado de la documentación

Esta carpeta se redactó al cierre de la fase 0 y se actualizó al implementarse la fase 1a (identidad). Describe el comportamiento **previsto** de la fase 1. Los documentos de autenticación, actores y jerarquía y permisos incluyen una sección "Qué funciona hoy" que distingue lo ya implementado de lo pendiente, y sus "Preguntas abiertas" recogen las decisiones que la implementación tuvo que asumir. El estado global está en [`roadmap-and-status.md`](roadmap-and-status.md). Cada vez que el plan cambie una regla de negocio, se actualiza primero el plan y después estos documentos.
