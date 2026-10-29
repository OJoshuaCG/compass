# Segundo factor (2FA) de las plataformas

**Fuente en el plan:** "2FA/TOTP: registro y generación de códigos" (incluye "Métodos de registro", "Validación de la URI", "Confirmación obligatoria", "Flujo con celular (handoff)", "Generación de códigos", "Exportar el secreto" y "Cambiar o retirar el 2FA"), "Modelo de autorización" (niveles de compartición) y "Decisiones cerradas (ADR)" (decisiones 013 y 017).

Este documento trata del segundo factor de las **plataformas externas** guardadas en la bóveda (por ejemplo, el código de seis dígitos que pide Instagram). El segundo factor de la entrada al propio sistema se describe en [`authentication.md`](authentication.md). Los personajes de los ejemplos están en el [glosario](README.md#personajes-de-los-ejemplos).

## Contenido

1. [La idea central](#1-la-idea-central)
2. [Los cinco métodos de registro](#2-los-cinco-métodos-de-registro)
3. [Qué se valida antes de aceptar un registro](#3-qué-se-valida-antes-de-aceptar-un-registro)
4. [Confirmación obligatoria](#4-confirmación-obligatoria)
5. [Registro con el celular, paso a paso](#5-registro-con-el-celular-paso-a-paso)
6. [Entrega de códigos](#6-entrega-de-códigos)
7. [Exportar el secreto](#7-exportar-el-secreto)
8. [Cambiar o retirar el segundo factor](#8-cambiar-o-retirar-el-segundo-factor)
9. [Reglas numeradas](#9-reglas-numeradas)
10. [Preguntas abiertas](#10-preguntas-abiertas)

## 1. La idea central

Muchas plataformas piden, además de la contraseña, un código de seis dígitos que cambia cada 30 segundos. Ese código se calcula a partir de una **clave secreta** que la plataforma entrega una sola vez al activar el segundo factor, normalmente como un código QR.

El sistema guarda esa clave cifrada y **calcula los códigos en el servidor**. Quien necesita entrar recibe solo los seis dígitos del momento. **Nunca recibe la clave.**

**Por qué.** Así un Operador usa el segundo factor sin poder llevárselo. Si la clave viviera en el teléfono personal de una persona, esa persona sería un punto único de falla: si se va o pierde el teléfono, nadie más entra. Y si cada quien guardara la clave, no habría control de quién puede generar códigos.

Los cinco métodos de registro están siempre disponibles. La persona elige el que prefiera, y todos terminan en el mismo proceso, con la misma validación y la misma confirmación.

## 2. Los cinco métodos de registro

| N.º | Método | Cómo funciona | Cuándo conviene |
| --- | --- | --- | --- |
| 1 | Captura de la pestaña | El navegador pide permiso para capturar la pestaña de la plataforma, toma una imagen, lee el código QR localmente y descarta la captura | En escritorio; es el método destacado en la interfaz |
| 2 | Imagen | La persona pega o sube una captura del código QR; se lee en el navegador | Cuando la captura de pestaña no está disponible |
| 3 | Clave manual | La persona pega la clave de texto o el enlace especial que la plataforma muestra en "¿No puedes escanear el código?" | Cuando la plataforma ofrece esa opción |
| 4 | Celular | Se usa la cámara del teléfono para leer el código QR (ver sección 5) | Pantallas que no permiten captura, o preferencia de la persona |
| 5 | Importar | Se carga la exportación de Google Authenticator o un archivo de otros autenticadores | Migrar segundos factores que hoy viven en teléfonos personales |

**La imagen del código QR nunca se sube al servidor.** Se lee en el navegador y solo viaja el dato ya extraído, por una conexión cifrada.

## 3. Qué se valida antes de aceptar un registro

| Aspecto | Regla |
| --- | --- |
| Tipo | Solo se admiten códigos basados en el tiempo. Los basados en contador no se admiten en la primera versión y se rechazan con un mensaje claro |
| Algoritmo | SHA1, SHA256 o SHA512. Si falta, se usa el valor estándar |
| Dígitos | 6 u 8. Si falta, el valor estándar |
| Periodo | 30 o 60 segundos. Si falta, el valor estándar |
| Clave secreta | Debe ser válida y tener al menos 128 bits. Se normalizan espacios y mayúsculas |
| Emisor y etiqueta | Se muestran a la persona para que confirme que es la cuenta correcta |

**Por qué mostrar emisor y etiqueta.** Evita registrar el segundo factor de una plataforma en la credencial equivocada.

## 4. Confirmación obligatoria

Registrar la clave no basta. Hay un paso de comprobación para evitar que la cuenta quede bloqueada por un registro mal hecho.

1. Tras registrar, el sistema muestra el código actual.
2. La persona lo escribe en la plataforma para terminar de activar su segundo factor.
3. La persona confirma en el sistema que la plataforma lo aceptó.
4. Solo entonces el secreto pasa a estar **verificado**.

Mientras no se confirma, el secreto está **pendiente**. Si pasan **24 horas** sin verificarse, el sistema genera un aviso: puede ser una cuenta a punto de quedar bloqueada. El aviso llega por correo, en su idioma, a la persona que registró el segundo factor, una sola vez por registro (si lo vuelve a registrar, empieza un plazo nuevo de 24 horas). No sale en el mismo instante: un proceso aparte lo revisa cada pocos minutos y lo reintenta si el correo falla. El correo solo dice cuándo se registró y pide confirmar o retirar el segundo factor; no menciona la cuenta ni la credencial, para que el propio aviso no filtre información. Si entre el aviso y el envío la persona lo confirma o lo retira, no se envía. Si quien lo registró ya no está activa, no se avisa a nadie más (ver pregunta abierta 2 y la 7).

**Ejemplo.** Luis activa el segundo factor de la cuenta de Instagram. Registra la clave, el sistema muestra el código 482 913, él lo introduce en Instagram y esta lo acepta. Luis confirma en el sistema y el secreto queda verificado. Si se hubiera ido a comer antes de confirmar y no regresara, a las 24 horas saltaría un aviso.

## 5. Registro con el celular, paso a paso

Es el método para pantallas donde no se puede capturar el código QR de la plataforma.

| Paso | Qué ocurre |
| --- | --- |
| 1 | En el escritorio, la persona elige "Usar mi celular" para una credencial concreta. Exige sesión activa y EDIT sobre la cuenta |
| 2 | El sistema crea una solicitud de un solo uso, con vigencia de **5 minutos**, ligada a esa persona y a esa credencial |
| 3 | El escritorio muestra un código QR con el enlace de la solicitud. **Ese enlace nunca se envía por correo ni por chat** |
| 4 | El celular abre una página web ligera (no hace falta instalar una aplicación) y usa la cámara para leer el código QR de la plataforma. Exige una conexión segura |
| 5 | El celular envía el dato al sistema. La solicitud solo vale para esa acción y una sola vez; la página borra lo que tenía |
| 6 | El escritorio recibe el aviso y muestra emisor y etiqueta. **La persona confirma en el escritorio** antes de guardar |
| 7 | Sigue la confirmación obligatoria con la plataforma (sección 4) |

**Por qué se confirma en el escritorio.** Si alguien fotografiara el código QR de la solicitud, podría intentar enviar su propio secreto desde su teléfono. Al exigir que la persona revise y confirme en su pantalla lo que se va a guardar, esa inyección queda detectada.

## 6. Entrega de códigos

Quien necesita un código lo pide y recibe los dígitos actuales y cuántos segundos de vigencia le quedan.

| Aspecto | Regla |
| --- | --- |
| Quién | Quien tenga USE o superior sobre la cuenta y el permiso de usar códigos de segundo factor |
| Qué recibe | El código actual y su vigencia. Si faltan menos de 5 segundos, también el siguiente código |
| Límite | Se limita la frecuencia por persona y por credencial |
| Auditoría | Cada código emitido queda registrado como evento ligero, que se puede agrupar en reportes |
| Reloj | Los servidores se sincronizan con una fuente de hora oficial; se monitorea el desfase y se alerta si supera 2 segundos |

**Por qué incluir el código siguiente.** Si la persona pide el código cuando solo le quedan unos segundos, se vencería antes de que alcance a escribirlo.

**Ejemplo.** Sofía tiene USE sobre la cuenta de Instagram. Necesita entrar y pide el código: recibe 705 118 con 22 segundos de vigencia. Lo escribe a tiempo. Más tarde pide otro: faltan 3 segundos, así que recibe el actual y el siguiente. En ningún momento ve la contraseña ni la clave del segundo factor. Quedan dos eventos de auditoría ligera.

## 7. Exportar el secreto

Exportar es mostrar la clave misma del segundo factor, que permite generar códigos fuera del sistema. Es una de las acciones más delicadas.

| Aspecto | Regla |
| --- | --- |
| Quién | Quien tenga MANAGE sobre la cuenta y el permiso de exportar (techo: Líderes) |
| Exigencias | Reautenticación y motivo escrito |
| Qué se muestra | El código QR y la clave, una sola vez |
| Auditoría | Evento crítico: avisa en tiempo real a la Raíz y a los gestores de la cuenta |
| Efecto en la salud | La credencial queda marcada como "secreto expuesto" (ver [`governance.md`](governance.md), salud de credenciales) |

**Ejemplo.** Ana, con MANAGE sobre una cuenta, necesita pasar el segundo factor a un colaborador externo en otro sistema. Se reautentica, escribe el motivo y exporta. El sistema avisa a la Raíz y a los demás gestores, registra el evento crítico y marca la credencial como "secreto expuesto" en su panel de salud.

## 8. Cambiar o retirar el segundo factor

| Acción | Qué exige | Qué pasa |
| --- | --- | --- |
| Registrar de nuevo (cambiar) | Ver sección 4 | Se crea una versión nueva; la anterior se conserva **30 días**, por si la plataforma no aceptó el cambio |
| Retirar el segundo factor de una cuenta | EDIT | Queda marcado en la salud de la credencial |

## 9. Reglas numeradas

| N.º | Regla |
| --- | --- |
| DF-1 | Los cinco métodos de registro están siempre disponibles y terminan en el mismo proceso, con la misma validación y confirmación |
| DF-2 | La imagen del código QR nunca se sube al servidor; solo se envía el dato ya extraído |
| DF-3 | Solo se admiten códigos basados en el tiempo; los basados en contador se rechazan con un mensaje claro |
| DF-4 | El secreto se guarda cifrado y los códigos los calcula el servidor; nadie con nivel USE recibe la clave |
| DF-5 | Un registro no cuenta hasta que la plataforma acepta el código y la persona lo confirma |
| DF-6 | Un secreto pendiente por más de 24 horas genera un aviso |
| DF-7 | En el método del celular, la solicitud dura 5 minutos, es de un solo uso y se confirma en el escritorio |
| DF-8 | Obtener un código exige USE y el permiso correspondiente, y se audita cada emisión |
| DF-9 | Exportar la clave exige MANAGE, el permiso, reautenticación y motivo; es un evento crítico y marca la credencial como expuesta |
| DF-10 | Cambiar el segundo factor conserva la versión anterior 30 días; retirarlo exige EDIT y se marca en la salud |

## 10. Preguntas abiertas

| N.º | Pregunta | Por qué importa |
| --- | --- | --- |
| 1 | Qué nivel de acceso exige registrar el segundo factor con cada método | El plan lo exige expresamente (EDIT) para el método del celular; para los demás dice que terminan en el mismo proceso, pero no repite el nivel |
| 2 | Qué pasa con un secreto pendiente pasadas las 24 horas, además del aviso: si se cancela solo o se queda esperando | El plan prevé el aviso, sin una acción posterior |
| 3 | Si una importación de otro autenticador que trae varias cuentas a la vez se confirma por cada una o en conjunto | El plan describe el método sin detallar la confirmación múltiple |
| 4 | Qué formatos de otros autenticadores se admiten además de la exportación de Google Authenticator | El plan menciona "archivo de otros autenticadores" sin lista |
| 5 | Qué límite de frecuencia exacto aplica a la emisión de códigos | El plan indica el límite, no su valor |
| 6 | Si se podrán admitir códigos basados en contador en una versión posterior | El plan solo dice que se rechazan en la primera versión |
| 7 | A quién más avisa el aviso de 24 h además de quien registró (el responsable de la cuenta, la Raíz) y qué pasa si quien registró ya no está activa. Hoy solo se avisa a quien registró y, si no puede recibirlo, no se avisa a nadie | El plan dice "genera un aviso" sin decir a quién; se aplicó la opción más conservadora |
