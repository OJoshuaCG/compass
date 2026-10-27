# Gobernanza: auditoría, bajas, salud y acceso temporal

**Fuente en el plan:** "Gobernanza: auditoría, bajas, salud y acceso temporal" (incluye "Auditoría", "Bajas con rotación", "Salud de credenciales" y "Acceso temporal (JIT)"), "Observabilidad y seguridad operativa" (alertas, respuesta a incidentes y cumplimiento), "Modelo de autorización" (niveles y permisos) y "Decisiones cerradas (ADR)" (decisión 016).

Estas cuatro capacidades convierten al sistema en algo mejor que una hoja de cálculo con contraseñas: permiten saber quién accedió a qué, cerrar el acceso de quien se va, ver el riesgo acumulado y reducir el acceso permanente. Los personajes de los ejemplos están en el [glosario](README.md#personajes-de-los-ejemplos).

## Contenido

1. [Auditoría](#1-auditoría)
2. [Bajas con rotación](#2-bajas-con-rotación)
3. [Salud de credenciales](#3-salud-de-credenciales)
4. [Acceso temporal con aprobación](#4-acceso-temporal-con-aprobación)
5. [Alertas críticas y señales de operación](#5-alertas-críticas-y-señales-de-operación)
6. [Respuesta a incidentes](#6-respuesta-a-incidentes)
7. [Datos personales](#7-datos-personales)
8. [Reglas numeradas](#8-reglas-numeradas)
9. [Preguntas abiertas](#9-preguntas-abiertas)

## 1. Auditoría

La auditoría es el registro de **quién hizo qué y cuándo**. Es la evidencia que permite investigar un incidente y rendir cuentas.

### 1.1 Qué garantiza

| Garantía | Qué significa |
| --- | --- |
| No se puede alterar | Los eventos solo se agregan; ninguna persona ni la propia aplicación puede modificarlos o borrarlos |
| Cadena verificable | Cada evento incluye una huella del anterior, de modo que cualquier alteración rompe la cadena. Una verificación diaria comprueba la cadena de cada organización y alerta si se rompe |
| Misma operación que la acción | El evento se escribe junto con la acción. **Si la auditoría falla, la acción sensible falla**: no se permite actuar sin dejar constancia |
| Copia externa inmutable | Los eventos se exportan periódicamente a un almacenamiento que ni siquiera un administrador de la base de datos puede reescribir |

### 1.2 Qué se registra y qué nunca

| Se registra | No se registra nunca |
| --- | --- |
| Acciones sensibles: revelar contraseñas, emitir códigos de segundo factor, exportar secretos, compartir y revocar, cambios de rango y de roles, bajas, transferencias, acceso de emergencia y acceso temporal | Secretos, **ni siquiera parciales** (contraseñas, claves de segundo factor, códigos de recuperación) |
| Copiar el usuario de una cuenta (como evento ligero) | Datos que no estén en la lista de campos permitida para los metadatos de cada evento |
| **Negaciones**, con su motivo: un intento rechazado también deja huella | |
| Quién actuó, sobre qué, resultado, dirección de red e identificador de la petición | |

**Por qué se registran las negaciones.** Un patrón de intentos negados repetidos es una señal de abuso (alguien probando qué puede hacer).

### 1.3 Quién puede leer la auditoría

| Permiso | Qué puede leer | Techo |
| --- | --- | --- |
| Leer toda la auditoría | Todos los eventos de la organización | Administradores |
| Leer la auditoría de su ámbito | Eventos de su subárbol y de sus propios recursos | Líderes |

La interfaz ofrece una línea de tiempo por persona, por cuenta y por credencial, con filtros y exportación a CSV.

### 1.4 Retención

**2 años en línea**, más tiempo en el archivo externo. Los plazos se deben ajustar a los requisitos legales y siguen pendientes de validar con el área legal.

### 1.5 Eventos críticos

Algunos eventos avisan **en tiempo real** a la Raíz y a los gestores del recurso:

1. Acceso de emergencia.
2. Exportación de un secreto de segundo factor.
3. Transferencia de la Raíz.
4. Uso de los códigos de emergencia de la Raíz.
5. Ruptura de la cadena de auditoría.
6. Superar el límite de revelaciones por hora.

## 2. Bajas con rotación

Cuando alguien deja la organización, no basta con cerrarle el acceso: conoce contraseñas que debe dejar de conocer. Por eso desactivar a una persona dispara un proceso completo **en una sola operación**: o ocurre todo o no ocurre nada.

### 2.1 Qué ocurre al desactivar a una persona

| Paso | Qué hace el sistema |
| --- | --- |
| 1 | Cierra todas sus sesiones |
| 2 | Reasigna a sus subordinados directos a su responsable (si era Administrador, a la Raíz) |
| 3 | Retira sus comparticiones directas y la saca de todos los grupos |
| 4 | Calcula su **exposición**: las credenciales cuya contraseña reveló y los segundos factores que exportó en los **últimos 180 días**, según la auditoría |
| 5 | Crea una **tarea de rotación** por cada credencial expuesta, asignada al gestor de la cuenta, con prioridad según el tipo de exposición |
| 6 | Registra un evento crítico con el resumen |

### 2.2 Tareas de rotación

- Un panel muestra las tareas pendientes, vencidas y completadas.
- Una tarea se cierra cuando se registra una **nueva versión del secreto**.
- Los mismos disparadores aplican al **revocar una compartición tras una revelación** (ver [`permissions-and-sharing.md`](permissions-and-sharing.md)).

### 2.3 Ejemplo resuelto

Ana desactiva a Luis, que dejó la empresa. En los últimos 180 días, Luis reveló la contraseña de la cuenta de Facebook de una marca y exportó el segundo factor de la cuenta de Instagram.

1. Las sesiones de Luis se cierran. Sofía, su subordinada, pasa a depender de Ana.
2. Luis sale de todos los grupos y pierde sus comparticiones directas.
3. El sistema calcula la exposición de Luis: dos credenciales.
4. Se crean dos tareas de rotación, una por credencial, asignadas a los gestores de cada cuenta.
5. Se registra un evento de auditoría crítico con el resumen.
6. Cuando el gestor de la cuenta de Facebook registra una nueva contraseña, esa tarea se cierra. La de Instagram sigue pendiente hasta que se registre un nuevo segundo factor.

## 3. Salud de credenciales

Cada credencial tiene un puntaje y señales de riesgo. **Nunca se guarda el secreto**; solo el resultado de la evaluación.

| Señal | Qué detecta |
| --- | --- |
| Contraseña débil | La contraseña es fácil de adivinar |
| Contraseña reutilizada | La misma contraseña se usa en otra credencial (se compara una huella, nunca el texto) |
| Antigüedad | La contraseña es más antigua de lo que permite la política de la organización |
| Sin segundo factor | La cuenta no lo tiene, o el registro sigue pendiente de verificar |
| Secreto expuesto | El segundo factor se exportó alguna vez |
| Correo de recuperación externo | El correo de recuperación está fuera de los dominios propios |
| Rotación pendiente | Existe una tarea de rotación sin cerrar |

Un panel de salud por organización, por grupo y por cuenta ayuda a priorizar qué atender primero.

**Ejemplo.** Ana abre el panel del grupo "Redes Marca MX" y ve que tres cuentas comparten la misma contraseña, una lleva meses sin cambiarla y otra no tiene segundo factor. Empieza por la que tiene la contraseña repetida y sin segundo factor, que es la más riesgosa.

## 4. Acceso temporal con aprobación

Reduce el acceso permanente: en lugar de dar acceso "por si acaso", la persona lo pide cuando lo necesita y vence solo.

| Paso | Qué ocurre |
| --- | --- |
| 1 | La persona solicita un nivel de acceso a una cuenta, con un **motivo** y una **duración** (máximo configurable; por defecto **8 horas**) |
| 2 | Aprueban quienes tengan MANAGE sobre la cuenta y el permiso de aprobar solicitudes |
| 3 | Al aprobar, se crea una compartición con vencimiento. El sistema la retira al vencer y, además, la ignora al decidir |
| 4 | Solicitud, decisión, uso y vencimiento quedan en la auditoría |

**Recomendación operativa del plan.** Que los Operadores tengan acceso permanente solo a lo que usan a diario y pidan el resto por tiempo limitado.

**Ejemplo.** Sofía necesita revisar un lunes una cuenta de Pinterest que normalmente no usa. Solicita nivel VIEW por 4 horas con el motivo "Auditoría trimestral de contenido". Luis, que tiene MANAGE sobre la cuenta, aprueba. Sofía tiene acceso hasta que pasan las 4 horas, y la compartición desaparece sin que nadie tenga que acordarse de retirarla.

## 5. Alertas críticas y señales de operación

Los eventos críticos (sección 1.5) avisan a las personas responsables. Además, el sistema vigila señales de operación y las clasifica por severidad:

| Señal | Severidad |
| --- | --- |
| Ruptura de la cadena de auditoría o falla al escribirla | Crítica |
| Solicitud de borrado o deshabilitación de la clave maestra de cifrado | Crítica |
| Uso de códigos de emergencia de la Raíz o acceso de emergencia | Crítica |
| Una persona supera el límite de revelaciones | Alta |
| Pico de ingresos fallidos o de negaciones de autorización | Alta |
| Errores del servicio de claves o caché de claves sin aciertos | Alta |
| Desfase del reloj mayor a 2 segundos | Media |
| Tareas de rotación vencidas | Media |

Se miden también indicadores de negocio y seguridad: ingresos exitosos y fallidos, revelaciones y códigos emitidos por hora, negaciones por motivo, tareas de rotación abiertas y vencidas, y segundos factores sin verificar.

## 6. Respuesta a incidentes

Se tienen procedimientos escritos (runbooks) que deben ensayarse antes de operar con datos reales. Los procedimientos están en [`../runbooks/`](../runbooks/README.md) y siguen como borradores pendientes de ensayo.

| Escenario | Respuesta de negocio |
| --- | --- |
| Sospecha de persona comprometida | Suspenderla, cerrar sus sesiones, revisar la auditoría y rotar todo lo que reveló |
| Sospecha de servidor comprometido | Rotar las claves de cifrado y las credenciales de infraestructura, revisar el uso del servicio de claves y evaluar una rotación masiva de credenciales de plataformas |
| Fuga de la base de datos, sin acceso al servicio de claves | Los secretos siguen protegidos; por precaución se rotan las claves y se revisan los accesos |
| Caída total | Procedimiento de contingencia con sobres sellados que contienen los códigos de recuperación de las cuentas críticas, guardados fuera del sistema |

## 7. Datos personales

Los correos de recuperación, los nombres y los registros de actividad de las personas son datos personales. En México aplica la ley de protección de datos personales en posesión de particulares. El plan pide un aviso de privacidad interno para las personas empleadas, finalidades del registro de auditoría y periodos de retención documentados, todo validado con el área legal antes de producción.

## 8. Reglas numeradas

| N.º | Regla |
| --- | --- |
| GO-1 | La auditoría solo agrega eventos; nadie los modifica ni los borra |
| GO-2 | Cada evento incluye una huella del anterior; una verificación diaria alerta si la cadena se rompe |
| GO-3 | Si la auditoría falla, la acción sensible falla |
| GO-4 | La auditoría nunca contiene secretos, ni siquiera parciales |
| GO-5 | Las negaciones también se auditan, con su motivo |
| GO-6 | Los eventos críticos avisan en tiempo real a la Raíz y a los gestores del recurso |
| GO-7 | Desactivar a una persona cierra sesiones, reasigna a su equipo, retira sus accesos y crea tareas de rotación, todo en una sola operación |
| GO-8 | La exposición de una persona se calcula con la auditoría de los últimos 180 días |
| GO-9 | Una tarea de rotación se cierra al registrar una nueva versión del secreto |
| GO-10 | La salud de una credencial guarda un puntaje, nunca el secreto |
| GO-11 | El acceso temporal tiene motivo y duración máxima (8 horas por defecto), la aprueba quien tiene MANAGE y el permiso, y vence solo |

## 9. Preguntas abiertas

| N.º | Pregunta | Por qué importa |
| --- | --- | --- |
| 1 | Cuántos días de plazo tiene una tarea de rotación y cómo se asigna la prioridad según el tipo de exposición | El plan dice "con prioridad según el tipo de exposición" sin definir las categorías |
| 2 | Quién se hace cargo de una cuenta si la persona dada de baja era su único gestor | La baja retira sus accesos y asigna tareas "al gestor de la cuenta", que podría no existir |
| 3 | Cómo se mantienen al día señales como la antigüedad de una contraseña, si la salud se calcula al escribir | El plan indica que se calcula al guardar; una contraseña envejece sin que nadie la guarde de nuevo |
| 4 | Cómo se garantiza que no se pierdan las negaciones cuando la acción se revierte | **Resuelta en la fase 1a:** cada negación se registra de forma independiente y queda en la auditoría aunque la acción se revierta (ver [`docs/adr/`](../adr/README.md), ADR 0022). Queda abierto cuántas negaciones repetidas conviene agrupar |
| 5 | Plazo de retención definitivo de la auditoría y de las versiones de secretos | Debe validarse con el área legal antes de producción |
| 6 | Si quien solicita un acceso temporal puede aprobarse a sí mismo cuando también tiene MANAGE | El plan define quién aprueba, sin prohibir expresamente la autoaprobación |
| 7 | A quién se notifica cuando se crea una solicitud de acceso temporal | El plan lista el flujo, no las notificaciones |
| 8 | Si la baja de una persona, que el plan califica como evento crítico de auditoría, también debe avisar en tiempo real | La lista de eventos que avisan en tiempo real (sección 1.5) no la incluye |
| 9 | Umbrales exactos de los picos de ingresos fallidos y de negaciones que activan alerta alta | El plan nombra la señal, no el umbral |
