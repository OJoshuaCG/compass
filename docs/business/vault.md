# La bóveda: plataformas, cuentas, credenciales y secretos

**Fuente en el plan:** "Bóveda: plataformas, cuentas, credenciales y compartición" (incluye "Catálogo de plataformas", "Casos de uso de la fase 1", "Generador de contraseñas", "Reglas de revelación en la interfaz", "Búsqueda y organización" e "Importación"), "Modelo de dominio y de datos" (campos cifrados y versionado de secretos), "Preparación para lectura de correos y SMS" (alias de cada cuenta) y "Hoja de ruta SSO y preparación del broker tipo Cerby" (propósito de uso del secreto).

La bóveda es el lugar donde el equipo guarda las cuentas de las plataformas externas y las usa sin intercambiar secretos por chat ni por hojas de cálculo. Este documento explica qué se guarda, quién puede hacer qué con ello y qué reglas protegen cada secreto. Los personajes de los ejemplos están en el [glosario](README.md#personajes-de-los-ejemplos).

## Contenido

1. [Los cinco conceptos](#1-los-cinco-conceptos)
2. [Catálogo de plataformas](#2-catálogo-de-plataformas)
3. [Alias de correo de cada cuenta](#3-alias-de-correo-de-cada-cuenta)
4. [Qué se protege y qué se ve en claro](#4-qué-se-protege-y-qué-se-ve-en-claro)
5. [Qué se puede hacer y qué exige cada acción](#5-qué-se-puede-hacer-y-qué-exige-cada-acción)
6. [Versiones de los secretos](#6-versiones-de-los-secretos)
7. [Revelar una contraseña](#7-revelar-una-contraseña)
8. [Usar el segundo factor sin ver el secreto](#8-usar-el-segundo-factor-sin-ver-el-secreto)
9. [Generador de contraseñas](#9-generador-de-contraseñas)
10. [Búsqueda y organización](#10-búsqueda-y-organización)
11. [Importación](#11-importación)
12. [Reglas numeradas](#12-reglas-numeradas)
13. [Preguntas abiertas](#13-preguntas-abiertas)

## 1. Los cinco conceptos

El negocio solía llamar "cuenta" a todo. El sistema distingue cinco cosas, porque cada una tiene reglas distintas.

| Concepto | Qué es | Ejemplo |
| --- | --- | --- |
| Plataforma | El servicio externo | Instagram |
| Cuenta | Un perfil concreto dentro de esa plataforma | La cuenta de la marca en Instagram |
| Credencial | Un acceso a esa cuenta. Una cuenta puede tener varias | "Acceso principal" y "Acceso del agente externo" |
| Secreto | Cada dato confidencial de una credencial | Usuario, contraseña, clave de segundo factor, códigos de recuperación, notas |
| Compartición | La autorización para que alguien use la cuenta, con un nivel | Sofía con nivel USE |

Hay tres tipos de credencial según cómo se accede a la plataforma:

| Tipo | Qué guarda |
| --- | --- |
| Solo contraseña | Usuario y contraseña |
| Contraseña y segundo factor | Usuario, contraseña y la clave del segundo factor |
| Solo segundo factor | Solo la clave del segundo factor |

## 2. Catálogo de plataformas

El catálogo de plataformas es información configurable, no algo fijo del sistema.

- Viene precargado con diez plataformas: Instagram, Facebook, TikTok, YouTube/Google, X, LinkedIn, Pinterest, Threads, Gmail y Outlook.
- La organización puede agregar **plataformas propias**.
- Existe una plataforma **"Personalizada"** que permite dar de alta cualquier sitio con su dirección web.
- Cada plataforma puede registrar sus **restricciones de contraseña** (longitud máxima o símbolos no admitidos), que el generador de contraseñas respeta.
- Para fases futuras, cada plataforma ya tiene reservados dos datos que hoy quedan vacíos: la forma de iniciar sesión en ella y las reglas para reconocer sus correos con códigos.

Quién puede editar el catálogo de la organización: quien tenga el permiso de gestionar el catálogo de plataformas (hasta Administradores; ver [`permissions-and-sharing.md`](permissions-and-sharing.md)). Las plataformas precargadas no se modifican desde la aplicación.

## 3. Alias de correo de cada cuenta

Decisión que se toma desde el primer día aunque la lectura de correos llegue después (fase 4):

1. Se reserva un **subdominio exclusivo** para esto (por ejemplo, uno separado del correo de las personas).
2. **Cada cuenta de plataforma recibe su propio alias único** de correo en ese subdominio.
3. Mientras el sistema no lea correos, el subdominio reenvía a un buzón operativo controlado por el equipo.
4. Desde el inicio se configuran las protecciones estándar de autenticidad del correo (SPF, DKIM y DMARC).

**Por qué.** Así las cuentas se crean desde el primer día con el correo definitivo que usarán siempre y no habrá que cambiarlo después en cada plataforma. El nombre y la configuración de este subdominio siguen como decisión pendiente (ver [`roadmap-and-status.md`](roadmap-and-status.md)).

## 4. Qué se protege y qué se ve en claro

| Dato | ¿Cifrado? | Por qué |
| --- | --- | --- |
| Usuario de la plataforma | Sí | En redes sociales, el usuario y el correo de recuperación son la mitad del ataque |
| Contraseña | Sí | Es el secreto principal |
| Clave del segundo factor | Sí | Con ella se generan los códigos |
| Códigos de recuperación de la plataforma | Sí | Permiten recuperar la cuenta |
| Notas secretas | Sí | Pueden contener información sensible |
| Nombre visible de la cuenta | No | Se muestra en listados y se busca |
| Nombre público de la cuenta (por ejemplo, @marca_mx) | No | Es público en la plataforma y se usa para buscar |
| Etiquetas, estado y grupo propietario | No | Organización y búsqueda |

Para poder buscar por usuario exacto sin guardar el usuario en texto legible, el sistema conserva una huella no reversible, específica de cada organización. Nunca se guarda ni se muestra el texto.

Del mismo modo, para detectar contraseñas repetidas entre credenciales, se comparan huellas, nunca contraseñas.

## 5. Qué se puede hacer y qué exige cada acción

Cada acción exige a la vez un permiso y un nivel de compartición sobre la cuenta (ver [`permissions-and-sharing.md`](permissions-and-sharing.md)).

| Acción | Permiso que exige | Nivel que exige | Qué ocurre |
| --- | --- | --- | --- |
| Crear una cuenta | Crear cuentas | (Ninguno, es nueva) | Quien la crea recibe MANAGE; opcionalmente se asigna a un grupo propietario |
| Editar una cuenta | Editar cuentas | EDIT | Se cambian los datos descriptivos, las etiquetas o el grupo propietario |
| Archivar una cuenta | Archivar cuentas | MANAGE | Se revocan todas las comparticiones; los secretos se conservan cifrados |
| Crear una credencial | Crear credenciales | EDIT | Se registran usuario, contraseña, segundo factor y códigos de recuperación |
| Cambiar una contraseña | Cambiar contraseñas y secretos | EDIT | Se crea una versión nueva, se actualiza la fecha de rotación y se comprueba si la contraseña ya se usa en otra credencial |
| Revelar una contraseña | Revelar contraseñas | VIEW | Exige reautenticación y motivo; queda auditado |
| Copiar el usuario | (Ninguno adicional) | USE | Queda en la auditoría ligera |
| Obtener un código de segundo factor | Usar códigos de segundo factor | USE | Ver [`two-factor.md`](two-factor.md) |
| Compartir o revocar | Compartir y revocar | MANAGE | Si se revoca tras una revelación, se crea una tarea de rotación |
| Ver el historial de versiones | (Ninguno adicional) | EDIT | Muestra versiones sin revelar su contenido; restaurar es una acción aparte |

**Ejemplo.** Luis crea la cuenta de Instagram de una marca. Automáticamente recibe MANAGE. Agrega una credencial de tipo "contraseña y segundo factor" con el usuario y la contraseña, y registra el segundo factor (ver [`two-factor.md`](two-factor.md)). Después comparte la cuenta con el grupo "Redes Marca MX" a nivel USE.

## 6. Versiones de los secretos

- Cada cambio de un secreto crea una **versión nueva**; la anterior queda como histórica.
- Las versiones históricas se conservan **30 días** (configurable) para recuperar una rotación que falló, por ejemplo si la plataforma no aceptó la contraseña nueva. Después se destruyen automáticamente.
- **Restaurar** una versión anterior es una acción auditada y exige EDIT.
- **Ver el historial** exige EDIT y solo muestra que existen versiones, sin revelar su contenido.

**Ejemplo.** Luis cambia la contraseña de la cuenta, pero la plataforma rechaza el cambio por un problema propio y la contraseña vieja sigue vigente. Como la versión anterior se conservó, Luis la restaura. El restablecimiento queda en la auditoría.

## 7. Revelar una contraseña

Revelar es mostrar la contraseña en pantalla. Es la acción más sensible sobre un secreto y tiene su propio conjunto de reglas.

### 7.1 Qué se exige

1. La persona tiene VIEW o superior sobre la cuenta **y** el permiso de revelar contraseñas.
2. Se reautentica (vale 5 minutos).
3. Escribe un **motivo**.
4. La acción queda en la auditoría, con ese motivo.

### 7.2 Cómo se muestra

- La contraseña **nunca aparece en listados ni en el detalle de la cuenta**. Solo aparece como respuesta a la acción de revelar.
- Se muestra oculta por defecto y **se vuelve a ocultar a los 30 segundos**.
- Al copiarla, el portapapeles se limpia a los 30 segundos. Es un esfuerzo razonable, no una garantía: el navegador puede impedirlo y los gestores de portapapeles del sistema operativo pueden conservar lo copiado.

### 7.3 Límite de revelaciones

Cada persona tiene un límite de revelaciones por hora (por defecto **30**, configurable). Si lo supera, el sistema **bloquea la acción y genera una alerta**. Superar el límite es un evento crítico y una alerta de severidad alta (ver [`governance.md`](governance.md)): una persona que revela decenas de contraseñas en una hora puede estar sacando información de forma masiva.

### 7.4 Ejemplo resuelto

Sofía tiene VIEW sobre una cuenta y el permiso de revelar contraseñas. Necesita la contraseña para recuperar un acceso.

1. Pulsa "Revelar". El sistema le pide reautenticarse: toca su passkey.
2. Escribe el motivo: "Recuperar acceso tras cambio de dispositivo".
3. La contraseña se muestra 30 segundos y se vuelve a ocultar.
4. La auditoría registra quién, qué cuenta, cuándo y el motivo.
5. Más tarde, la cuenta se revoca para Sofía. Como ella reveló la contraseña, el sistema crea una tarea de rotación para esa credencial.

## 8. Usar el segundo factor sin ver el secreto

Con nivel USE y el permiso correspondiente, una persona obtiene el **código actual** del segundo factor sin conocer nunca la clave que lo genera. El código lo calcula el servidor. Este es el mecanismo que permite trabajar en una plataforma sin tener ni la contraseña ni el secreto del segundo factor. El detalle completo está en [`two-factor.md`](two-factor.md).

## 9. Generador de contraseñas

Está integrado en la interfaz y en la API.

- Longitud configurable (por defecto **24** caracteres), selección de tipos de caracteres y opción de frase de contraseña.
- La contraseña se genera en el navegador de la persona; el servidor solo la recibe al guardarla.
- Respeta las restricciones que cada plataforma tenga registradas (longitud máxima, símbolos no admitidos).

## 10. Búsqueda y organización

- Se busca por nombre visible, nombre público, plataforma, etiquetas y grupo.
- La búsqueda **siempre** muestra solo lo que la persona puede ver según su acceso efectivo; nunca se cargan registros ajenos para descartarlos después.
- Se puede buscar por usuario exacto de la plataforma sin que el sistema guarde el usuario en claro.
- Cada persona puede guardar vistas propias. El plan menciona de ejemplo "Mis cuentas", "Sin 2FA" y "Por rotar".
- Quien tiene el permiso de inventario ve las cuentas de toda la organización, solo con datos descriptivos.

## 11. Importación

- Se admite la importación desde un archivo CSV, con **previsualización y validación** antes de guardar.
- El archivo se procesa en memoria y **nunca se guarda**.
- La importación llega al final de la fase 1. La compatibilidad con exportaciones de otros gestores de contraseñas queda para una fase posterior.

## 12. Reglas numeradas

| N.º | Regla |
| --- | --- |
| BO-1 | Una cuenta puede tener varias credenciales; cada credencial tiene sus propios secretos y versiones |
| BO-2 | Todos los secretos, incluido el usuario de la plataforma, se guardan cifrados |
| BO-3 | Solo el nombre visible y el nombre público de la cuenta están en claro |
| BO-4 | Quien crea una cuenta recibe MANAGE sobre ella |
| BO-5 | Archivar una cuenta revoca todas sus comparticiones, pero conserva los secretos cifrados |
| BO-6 | Cada cambio de un secreto crea una versión nueva; las anteriores se conservan 30 días y luego se destruyen |
| BO-7 | Restaurar una versión anterior exige EDIT y queda auditado |
| BO-8 | Un secreto solo se abre en tres momentos auditados: revelar, generar un código de segundo factor y, en el futuro, inyectar en una sesión. Toda lectura declara su propósito |
| BO-9 | Revelar una contraseña exige VIEW, permiso, reautenticación, motivo y auditoría |
| BO-10 | La contraseña nunca aparece en listados ni detalles; se oculta a los 30 segundos |
| BO-11 | Superar el límite de revelaciones por hora (30 por defecto) bloquea la acción y genera una alerta |
| BO-12 | Las contraseñas repetidas se detectan comparando huellas, nunca el texto |
| BO-13 | Todo listado y toda búsqueda se filtran por el acceso efectivo de la persona |
| BO-14 | La importación se procesa en memoria; el archivo nunca se guarda |

## 13. Preguntas abiertas

| N.º | Pregunta | Por qué importa |
| --- | --- | --- |
| 1 | Qué significa exactamente tener un "grupo propietario" de una cuenta: si ese grupo recibe un nivel de acceso por ser propietario | El plan lo menciona como opción al crear o editar una cuenta, sin precisar sus efectos |
| 2 | Si una cuenta archivada se puede restaurar y quién puede hacerlo | El plan define el archivo, no su reversión |
| 3 | Cuánto dura el bloqueo cuando alguien supera el límite de revelaciones, y quién lo levanta | El plan dice que se bloquea y se alerta, sin indicar duración |
| 4 | Qué reglas exactas definen una contraseña "antigua" para la salud de la credencial | El plan habla de una política de la organización sin dar el valor |
| 5 | Qué restricciones de contraseña concretas trae cada plataforma del catálogo | El plan prevé el dato pero no los valores |
| 6 | Qué ocurre con las vistas guardadas de una persona dada de baja | El plan no lo menciona |
