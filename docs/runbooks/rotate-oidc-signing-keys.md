# Runbook: Rotar las claves de firma OIDC

> **Borrador, pendiente de ensayo antes de producción.** El comando `signing-keys` existe y está probado ([ADR 0052](../adr/0052-oidc-provider-storage-clients-and-signing-keys.md)); el procedimiento no se ha ensayado con un KMS real.

## Objetivo

Cambiar la clave con la que Compass firma los tokens de inicio de sesión único (SSO) sin cortar a nadie: primero se publica la clave nueva y, pasada la ventana de caché de los clientes, se retira la vieja.

## Qué hace el comando

`pnpm --filter @iam/api signing-keys <acción>` (o `node dist/main.signing-keys.js <acción>`):

- `list`: una línea por clave activa, de la más antigua a la más nueva.
- `rotate [ES256|RS256]`: agrega una clave nueva (por defecto `ES256`) **sin retirar ninguna**.
- `retire <kid>`: retira esa clave. Se niega a retirar la última activa (`CRYPTO.LAST_SIGNING_KEY`).

Cada acción imprime **una línea JSON** con `event` (siempre `oidc_signing_key`), `action`, `kid`, `alg`, `at` (hora UTC) y `os_user` (usuario del sistema operativo que lo ejecutó). Nunca imprime ni registra la clave privada ni material derivado de ella.

## Precondiciones

- API compilada: `pnpm --filter @iam/api build`.
- Mismo entorno que la API (`DATABASE_URL` con el rol `iam_app` y el KMS configurado). El archivo de entorno lo custodia Ops.
- Un ticket de cambio abierto: la línea de salida es el único registro de quién rotó y cuándo.
- Nadie más ejecutando `rotate` ni `retire` al mismo tiempo. La negativa a retirar la última clave se comprueba en el servicio, no en la base de datos: dos `retire` simultáneos de las dos únicas claves activas podrían dejar cero (hay que repararlo con `rotate`). Una sola persona, un solo comando a la vez.

## Procedimiento

1. `signing-keys list` y anota los `kid` actuales.
2. `signing-keys rotate`. Adjunta la línea impresa al ticket.
3. **Reinicia la API**: carga las claves solo al arrancar. Hasta reiniciar, no publica la nueva.
4. Espera la ventana: como mínimo el tiempo de caché del JWKS de los clientes, para que todos ya conozcan la clave nueva. La clave vieja sigue firmando y publicándose durante la espera.
5. `signing-keys retire <kid de la clave vieja>`. Adjunta la línea al ticket.
6. **Reinicia la API** otra vez para que deje de publicar la clave retirada. Desde este reinicio firma la clave nueva; los tokens ya emitidos con la vieja y aún vigentes dejan de verificarse y esas personas tendrán que volver a iniciar sesión. Hazlo en un horario de poco uso.
7. `signing-keys list` debe mostrar solo la clave nueva.

## Salida y alertas

- Código `0`: la acción se hizo y la línea JSON está en la salida estándar.
- Código `1`: no se hizo nada (o la clave ya no estaba activa); el mensaje sale por stderr y una acción fallida no imprime línea JSON. Los errores propios del comando salen como `CÓDIGO: mensaje` con `USAGE` (argumentos inválidos) o `SIGNING_KEY_NOT_FOUND` (el `kid` no está activo). Los demás salen como `Falló la operación (CÓDIGO)` con `CRYPTO.KMS_UNAVAILABLE` o `CRYPTO.LAST_SIGNING_KEY`, o con el nombre del error si no trae código; nunca se imprimen detalles internos.

## Verificación

- `GET /jwks` de la API publica el `kid` nuevo tras el paso 3 y deja de publicar el viejo tras el paso 6.
- Un inicio de sesión SSO de prueba completa el flujo después de cada reinicio.

## Rollback

- Antes del paso 5: retira la clave **nueva** con `retire <kid nuevo>` y reinicia la API; la vieja nunca dejó de firmar.
- Después del paso 5 no se puede recuperar la clave retirada: se rota otra nueva y se repite el procedimiento.

## Auditoría

Cada `rotate` y cada `retire` escriben, en la misma sentencia que el cambio de la clave, una fila en `platform_audit_events` (`oidc_signing_key.added` o `oidc_signing_key.retired`, con el kid, el algoritmo y el actor `os:<usuario>`). La tabla es solo de inserción, también para el administrador, y nunca contiene material de claves. La clave inicial que crea el arranque de la API queda con el actor `system:api-process`. La línea JSON del ticket se conserva como evidencia complementaria.

## Orden de despliegue de la migración 0047

La migración 0047 reemplaza las firmas de `auth.add_oidc_signing_key` y `auth.retire_oidc_signing_key`. Aplícala y despliega la API nueva juntas: una API anterior que arranque sin clave activa fallaría al crear la clave inicial. El actor lo envía quien llama; la tabla confía en el proceso de la API y no puede probar la identidad por sí sola.

## Historial de ensayos

_Sin ensayos todavía._
