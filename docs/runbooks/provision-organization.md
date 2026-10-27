# Runbook: Dar de alta una organización

> **Borrador, pendiente de ensayo antes de producción.** El comando existe y está probado; lo que falta por definir es el canal con el que operaciones entrega la contraseña inicial y quiénes son los dos custodios de los códigos de emergencia (decisiones del equipo).

Referencias: [`plan.md`](../../plan.md) ("Autenticación del propio sistema" y reglas de jerarquía sobre la Raíz); [`docs/backend.md`](../backend.md) §3.6 (módulo `provisioning`); [ADR 0027](../adr/0027-emergency-codes-root-reset-model.md).

## Objetivo

Crear una organización con su persona Raíz, sus roles del sistema y los códigos de emergencia, dejando el alta en la auditoría. Estado final: la Raíz existe en estado "invitada" con una contraseña inicial de un solo uso, y dos custodios tienen los códigos de emergencia en papel.

## Cuándo usarlo

- Una organización nueva (hoy, la primera). Se ejecuta **una vez por organización**.
- No sirve para agregar personas (eso se hace por invitación desde la aplicación) ni para recuperar a una Raíz existente (ver [Usar un código de emergencia](use-emergency-code.md)).

## Precondiciones

- La base de datos ya tiene los roles preparados y las migraciones aplicadas (ver [`docs/database.md`](../database.md) §1).
- Una conexión de administración a la base de datos, no la del rol de la aplicación: ese rol no puede crear organizaciones. Se pasa por variable de entorno y no se escribe en el historial de la terminal compartida ni en tickets.
- Los datos de la organización: nombre, identificador corto (`slug`: minúsculas, dígitos y guiones, de 2 a 63 caracteres, empieza con letra o dígito), correo y nombre de la persona Raíz.
- Una terminal privada donde la salida estándar no se registre (ni en el historial ni en un sistema de bitácoras): el comando imprime secretos.
- Dos personas designadas como custodios y una impresora o medio equivalente para imprimir los códigos. Quiénes son los custodios es una decisión pendiente del equipo.
- La aplicación ya está desplegada y el correo configurado, para que la Raíz pueda entrar y los Administradores reciban alertas ([Configurar y comprobar el correo](configure-mail.md)).

## Pasos

1. Define las variables de entorno del comando: la conexión de administración (`PROVISION_DATABASE_URL`), `ORG_NAME`, `ORG_SLUG`, `ROOT_EMAIL` y `ROOT_NAME`. Si falta una o es inválida, el comando falla y nombra solo la variable, nunca su valor.
2. Ejecuta el comando de la API para dar de alta (`pnpm --filter @iam/api provision`, o su equivalente compilado con `node dist/main.provision.js` en el despliegue).
3. Del resultado, copia de inmediato **la contraseña inicial** y **los ocho códigos de emergencia**. Se muestran una sola vez: no se guardan en claro en ningún lugar y no se pueden recuperar.
4. Entrega la contraseña inicial a la Raíz por un canal seguro distinto del correo de invitación. El canal está por definir con el equipo.
5. Imprime los ocho códigos y reparte los papeles entre los dos custodios, fuera del sistema. Ninguna persona guarda todos. Después borra la salida de la terminal y cualquier copia temporal.
6. Pide a la Raíz que entre, cambie la contraseña inicial (es obligatorio) y registre su segundo factor. Debe guardar los diez códigos de recuperación ordinarios que se muestran una sola vez.
7. Anota la fecha, quién ejecutó el alta y quiénes son los custodios, sin copiar ningún código.

## Verificación

- La Raíz puede entrar, se le obliga a cambiar la contraseña, registra su segundo factor y queda activa.
- Existe un evento de auditoría `organization.provisioned` de la organización.
- Los dos custodios confirman por separado que recibieron sus códigos.
- No quedan códigos ni la contraseña inicial en el historial de la terminal, en tickets ni en el repositorio.

## Rollback

- Si el comando falla a la mitad, no queda una organización parcial: el alta ocurre en una sola transacción. Corrige la causa y repite.
- Si se perdió la salida antes de copiarla, no hay manera de recuperar la contraseña ni los códigos. Hoy no existe un comando para regenerarlos: la organización recién creada, sin uso, se descarta con una intervención directa de administración de la base de datos (por definir) y se repite el alta con otro identificador.
- Si un código o la contraseña pudo verse por alguien no autorizado, trátalo como un compromiso y sigue [Usuario o servidor comprometido](compromised-user-or-server-response.md).

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Operaciones | Ejecuta el comando y entrega la contraseña inicial |
| Dos custodios | Reciben y guardan los códigos de emergencia, cada uno por separado |
| Raíz | Cambia la contraseña inicial y registra su segundo factor |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
