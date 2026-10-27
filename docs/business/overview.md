# Resumen general del producto

**Fuente en el plan:** "Resumen ejecutivo", "Decisiones cerradas (ADR)", "Multitenancy preparada desde el día uno", "Bóveda: plataformas, cuentas, credenciales y compartición", "Gobernanza: auditoría, bajas, salud y acceso temporal" y "Registro de riesgos".

## Contenido

1. [Propósito](#1-propósito)
2. [El problema que resuelve](#2-el-problema-que-resuelve)
3. [Quién lo usa](#3-quién-lo-usa)
4. [Qué ofrece la primera versión](#4-qué-ofrece-la-primera-versión)
5. [Principios](#5-principios)
6. [Qué NO hace](#6-qué-no-hace)
7. [Riesgos principales de negocio](#7-riesgos-principales-de-negocio)
8. [Preguntas abiertas](#8-preguntas-abiertas)

## 1. Propósito

La plataforma es un sistema interno, de una sola organización, para tres cosas a la vez:

1. **Gestionar personas**: quién es parte de la organización, qué rango tiene y quién responde por quién.
2. **Controlar permisos**: qué puede hacer cada persona dentro del sistema.
3. **Custodiar accesos compartidos**: una bóveda donde el equipo guarda las cuentas de plataformas externas (por ejemplo, redes sociales), con sus contraseñas y sus códigos de segundo factor, y las usa sin intercambiar secretos por chat o por hojas de cálculo.

Todo ocurre con una auditoría que no se puede manipular: siempre se puede saber quién accedió a qué.

El sistema guarda secretos reales de la empresa. Por eso, cuando la seguridad y la velocidad chocan, gana la seguridad.

## 2. El problema que resuelve

Hoy, el acceso a las cuentas de plataformas suele vivir en una hoja de cálculo o en la memoria de unas pocas personas. Eso produce problemas muy concretos:

| Situación frecuente | Consecuencia | Cómo la atiende el sistema |
| --- | --- | --- |
| Las contraseñas se comparten por chat o correo | No hay control de quién las conoce | Se comparten dentro del sistema, con un nivel de acceso y fecha de vencimiento opcional |
| El código de segundo factor vive en el teléfono de una persona | Si esa persona no está, nadie entra | El sistema guarda el secreto y entrega el código a quien tenga permiso |
| Alguien se va de la empresa y conocía las contraseñas | Nadie sabe qué cambiar | La baja calcula qué conocía esa persona y crea tareas de rotación |
| Nadie sabe quién entró a una cuenta | No hay forma de investigar un incidente | Toda revelación y todo uso quedan en la auditoría |
| Un empleado nuevo necesita acceso para trabajar un día | Se le da acceso permanente "por si acaso" | El acceso temporal con aprobación vence solo |
| Una persona con permisos de gestión ve todo | Un error de un administrador expone todos los secretos | Gestionar personas no da acceso a secretos |

## 3. Quién lo usa

Cuatro tipos de persona, ordenados por autoridad. El detalle completo está en [`actors-and-hierarchy.md`](actors-and-hierarchy.md).

| Actor | Papel resumido |
| --- | --- |
| Raíz | Dueña de la organización. Una sola persona |
| Administrador | Gestiona su rama de Líderes y Operadores |
| Líder | Gestiona a los Operadores de su rama |
| Operador | Usa las cuentas que le comparten |

Es un producto pensado para un equipo pequeño. Aun así, la organización puede crecer sin que cambie la forma de trabajar.

## 4. Qué ofrece la primera versión

La primera versión (fase 1) se entrega en tres partes, descritas en [`roadmap-and-status.md`](roadmap-and-status.md):

| Parte | Qué entrega al negocio |
| --- | --- |
| Identidad (1a) | Invitar personas, que definan su contraseña y registren un segundo factor obligatorio, entrar con passkey, y una jerarquía con permisos |
| Bóveda y segundo factor (1b) | Dar de alta cuentas y credenciales, compartirlas con personas y grupos, revelar contraseñas con auditoría y generar códigos de segundo factor sin mostrar el secreto |
| Gobernanza (1c) | Auditoría verificable, bajas con rotación, panel de salud, acceso temporal con aprobación y alertas críticas |

La versión llega a uso interno real solo después de una prueba de intrusión externa.

## 5. Principios

1. **Todo se construye a la medida, pero ninguna pieza de seguridad se inventa.** La criptografía, el manejo de contraseñas y los protocolos de inicio de sesión usan componentes auditados y ampliamente aceptados.
2. **Se niega por defecto.** Si ninguna regla autoriza una acción, la acción no ocurre.
3. **Gestionar personas no es acceder a secretos.** Ser jefe de alguien no da acceso a sus cuentas. El acceso a un secreto solo existe por una compartición explícita y auditada.
4. **Nadie otorga lo que no tiene.** Una persona no puede dar a otra un permiso o un nivel de acceso superior al suyo.
5. **El secreto no sale cuando no hace falta.** Un Operador puede usar el segundo factor de una cuenta sin poder llevarse el secreto que lo genera.
6. **Si no se puede auditar, no se hace.** Las acciones sensibles se rechazan si el sistema no logra dejar constancia.
7. **Se entrega por fases usables.** No se abre una fase hasta cumplir los criterios de salida de la anterior.
8. **Nada se borra.** Las personas se desactivan, las cuentas se archivan y los secretos viejos se conservan un tiempo limitado; la historia se mantiene.

## 6. Qué NO hace

### 6.1 No es zero-knowledge

Un sistema "zero-knowledge" es aquel donde el servidor jamás puede leer los secretos, porque solo las personas poseen las claves. **Este producto no es así, y es una decisión deliberada.** Los secretos se cifran en el servidor con claves propias de la organización, protegidas por un servicio de gestión de claves (KMS) del proveedor de nube.

¿Por qué? Porque varios requisitos del negocio son incompatibles con que el servidor no pueda leer:

| Requisito del negocio | Por qué contradice el zero-knowledge |
| --- | --- |
| Compartir cuentas con personas y grupos, y quitar el acceso al instante | Si solo las personas tuvieran las claves, cada compartición exigiría entregar claves a cada persona y cada revocación, recifrar todo |
| Que el dueño (la Raíz) conserve control sobre la organización | Sin acceso del servidor, perder una clave personal significaría perder los secretos |
| Recuperar el acceso de alguien que perdió sus factores | Sin acceso del servidor, no habría recuperación posible |
| Generar los códigos de segundo factor en el servidor para que nadie se lleve el secreto | El servidor debe conocer el secreto para calcular el código |
| Leer códigos que llegan por correo o SMS (fases futuras) | El servidor debe poder abrir el contenido para extraer el código |

**Qué significa en la práctica:**

- Quien controle el servidor **y** el servicio de claves al mismo tiempo podría leer los secretos. Por eso el acceso al servicio de claves es mínimo, está en red privada, se monitorea y existen procedimientos de respuesta (ver [`governance.md`](governance.md)).
- Si alguien obtiene solo una copia de la base de datos, sin el servicio de claves, los secretos siguen protegidos.
- El cifrado de cada secreto está ligado a su organización y a su credencial: un texto cifrado copiado a otro registro no se puede abrir.

### 6.2 Otras cosas que la primera versión no hace

| No incluye | Motivo o momento previsto |
| --- | --- |
| Servir como proveedor de inicio de sesión único para otras aplicaciones | Fases 2 y 3 |
| Leer códigos de segundo factor que llegan por correo | Fase 4 |
| Leer códigos que llegan por SMS | Fase 5 |
| Autocompletar desde una extensión de navegador | Fase 6 |
| Iniciar sesión en una plataforma sin revelar la contraseña (nivel USE completo) | Fase 7; se prepara desde la fase 1 pero no se construye |
| Cambiar automáticamente las contraseñas en las plataformas | Depende de los mismos mecanismos frágiles de la fase 7 |
| Usar SMS o correo como segundo factor del propio sistema | Son los factores más débiles; el sistema protege el segundo factor de toda la organización |
| Entrar con cuentas de Google Workspace o Microsoft 365 | No se usa en la fase 1; solo se deja preparado el punto de conexión |
| Alta de nuevas organizaciones por autoservicio, facturación, dominios personalizados o consola de superadministración | Cuando llegue la segunda organización, se crea mediante un procedimiento de operación auditado |
| Permitir que una persona pertenezca a varias organizaciones | Hoy el correo de acceso es único en todo el sistema; si se necesita, se decidirá más adelante |
| Grupos dentro de grupos | No hay grupos anidados en la primera versión |
| Importar exportaciones de otros gestores de contraseñas | La importación inicial es solo por archivo CSV; otros formatos en una fase posterior |
| Eliminar usuarios | Solo se desactivan, para conservar la integridad de la auditoría |

### 6.3 Límites honestos de las protecciones

El plan es explícito sobre lo que ninguna medida puede evitar:

- **Quien tiene acceso legítimo puede copiar lo que ve.** Si una persona tiene VIEW sobre una cuenta, puede anotar la contraseña. Las contramedidas son el nivel USE (usar sin ver), los límites de revelaciones por hora, los motivos escritos, las alertas, el acceso temporal y la rotación en las bajas.
- **La limpieza del portapapeles es de mejor esfuerzo.** El navegador puede impedirla y los gestores de portapapeles del sistema operativo pueden retener lo copiado.
- **Una extensión de navegador no protege contra un usuario decidido.** Cuando exista, protegerá contra la exposición casual, no contra alguien con herramientas de desarrollador.

## 7. Riesgos principales de negocio

Resumen de los riesgos del plan que más afectan a quien usa el producto. La tabla completa está en la sección "Registro de riesgos" del plan.

| Riesgo | Efecto para el negocio | Respuesta del plan |
| --- | --- | --- |
| Alcance excesivo: tres personas construyendo lo que en el mercado son tres productos | Un producto a medias guardando secretos reales | Fases con criterios de salida y alcance congelado por fase |
| La Raíz queda sin acceso o fuera de la organización | Nadie puede gestionar a los Administradores | Códigos de emergencia custodiados y transferencia de la Raíz |
| El sistema se cae en horario de operación | El equipo de redes sociales se queda sin acceso | Alta disponibilidad, respaldos y sobres sellados con códigos de recuperación de cuentas críticas |
| Un segundo factor mal registrado | Cuenta bloqueada | Confirmación obligatoria, versiones anteriores durante 30 días y alerta si queda sin verificar |
| Abuso interno de una persona con acceso legítimo | Salida silenciosa de secretos | Nivel USE, límites, motivos, alertas, acceso temporal y rotación en bajas |
| Pérdida del acceso a las claves de cifrado | Pérdida total de los secretos | Protección contra borrado, alertas y simulacros de restauración trimestrales |

## 8. Preguntas abiertas

| Pregunta | Detalle | Dónde se decide |
| --- | --- | --- |
| Proveedor de nube definitivo | El plan toma AWS como referencia y pide confirmar o elegir otro antes de cerrar la fase 0 | Decisiones pendientes del equipo |
| Escala esperada el primer año | Usuarios, cuentas de plataforma y revelaciones diarias aproximadas; ajusta límites y capacidad | Decisiones pendientes del equipo |
| Disponibilidad requerida | Horario de operación y tolerancia a caídas; valida el objetivo de pérdida máxima de datos de 5 minutos y de recuperación de 4 horas | Decisiones pendientes del equipo |
| Requisitos legales de datos personales | Los correos de recuperación, nombres y registros de actividad son datos personales; el plan pide aviso de privacidad interno y validación con el área legal antes de producción | Sección "Cumplimiento" del plan |
