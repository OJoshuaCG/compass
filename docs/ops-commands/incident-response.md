# Comandos: fuga de datos y servidor comprometido (borrador)

Completa los runbooks [data-breach-response](../runbooks/data-breach-response.md) y [compromised-user-or-server-response](../runbooks/compromised-user-or-server-response.md). Comparten casi todos sus comandos, por eso están juntos. Leyenda y advertencias en el [README](README.md).

## Resumen por paso

| Runbook y paso | Estado | Comando o razón |
| --- | --- | --- |
| Fuga, 1 · Rotar credenciales de base de datos | **Propuesto** | Bloque A. |
| Servidor, 3 · Rotar credenciales de infraestructura (base) | **Propuesto** | Bloque A. |
| Servidor, 3 · Rotar credenciales de proveedores (correo saliente) | **Por definir** | El proveedor SMTP no está en el repositorio; se rota en su panel y se actualiza la variable en Dokploy. |
| Fuga, 2 · Alcance de la copia de datos | **Por definir** | Depende de qué registra el servidor de PostgreSQL (`log_connections`, copias de seguridad ajenas). No se verificó la configuración del servidor. |
| Fuga, 3 y Servidor, 4 · Uso del KMS | **Propuesto** | Bloque B. |
| Servidor, 1 · Aislar la instancia | **Existe** (Dokploy) y **Por definir** (KMS) | Detener la aplicación desde Dokploy ([`deployment.md`](../deployment.md) §2.6). Cortar el acceso al KMS depende de cómo se autentica la API: **no verificado**, ver bloque C. |
| Fuga, 6 · Invalidar todas las sesiones | **Por definir** | No encontré una operación masiva. Existe revocar las de una persona al desactivarla (A1); no verifiqué si hay algo para toda la organización. |
| Fuga, 7 · Verificar la cadena de auditoría | **Por definir** | R1 del TODO (auditoría con verificación de la cadena) sigue abierta; no encontré un comando de verificación. |
| Fuga, 8 · Plazos y contenido del aviso | **Por definir** | Decisión legal (C9), no un comando. |

## Bloque A. Rotar la contraseña de un rol de base de datos

Hay que repetirlo por cada rol que use la plataforma (la lista está en [`database.md`](../database.md)). Escribe la contraseña de forma interactiva, nunca en la línea de comandos, para que no quede en el historial.

```bash
psql "postgres://<admin>@<host>/<base>"
# dentro de psql:
\password <rol>
```

Después: actualizar la variable correspondiente en Dokploy (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, etc.) y redesplegar. La API usa el rol `iam_app`; las migraciones, `iam_migrator` ([`deployment.md`](../deployment.md) §2.5).

## Bloque B. Revisar el uso de la llave del KMS

Registros de AWS CloudTrail para la llave, en una ventana de tiempo. `lookup-events` solo ve los últimos 90 días. Que `Decrypt` y `GenerateDataKey` aparezcan aquí es lo esperado, pero **no se probó contra AWS real** (el propio handoff lo señala para el adaptador).

```bash
aws cloudtrail lookup-events --region <region> \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=<arn-de-la-llave> \
  --start-time <AAAA-MM-DDThh:mm:ssZ> --end-time <AAAA-MM-DDThh:mm:ssZ> \
  --query 'Events[].{hora:EventTime,evento:EventName,usuario:Username}'
```

Qué buscar: llamadas desde un rol o dirección que no sea la de la API, y picos de `Decrypt` fuera del patrón habitual.

## Bloque C. Cortar el acceso de una instancia al KMS

No hay comando seguro que escribir hasta saber **cómo se autentica la API contra AWS**. Se buscó `AWS_ACCESS_KEY` en `apps/api/src/app/config.ts` y en el ADR 0020 y no apareció. Según la respuesta:

- **Con llaves de acceso de un usuario de IAM:** desactivar la llave (`aws iam update-access-key --access-key-id <id> --status Inactive --user-name <usuario>`) y crear una nueva.
- **Con un rol:** añadir una política que niegue `kms:*` sobre la llave a ese rol, o quitar la relación de confianza.

Ambas opciones son propuestas sin ensayar. Elegir una exige saber cuál es la real.

## Después de cualquier incidente

Rotar la DEK por precaución con [rotate-dek.md](rotate-dek.md); tras una rotación por incidente, reiniciar la API para que suelte su caché de claves (paso 5 del runbook).
