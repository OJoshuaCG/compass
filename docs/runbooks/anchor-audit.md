# Runbook: Programar el ancla externa de la auditoría

> **Borrador, pendiente de ensayo antes de producción.** El comando existe y está probado ([ADR 0042](../adr/0042-audit-chain-external-anchoring.md)). Ops todavía tiene que crear el bucket, verificar sus garantías y programar el cron.

## Objetivo

Que `anchor-audit` corra solo, **una vez al día**, y deje en un almacenamiento que nadie puede borrar la cabeza de la cadena de auditoría de cada organización. Así se detecta lo que la cadena por sí sola no detecta: que alguien borre los eventos más recientes, reescriba y recalcule la cadena, o restaure una base vieja.

## Qué hace

- Por cada organización registra en `audit_anchors` el `seq` y el `hash` del último evento de auditoría. La base asigna el número de manifiesto, el hash del manifiesto anterior y el hash propio; el comando no los decide.
- Publica ese mismo manifiesto en el bucket como `audit-anchors/<organización>/<número de 12 dígitos>-<hash del manifiesto>.json`, con Object Lock en **modo de cumplimiento** y retención de **2 años de calendario** (misma fecha y hora dos años después; un 29 de febrero pasa al 1 de marzo). Durante ese plazo nadie borra ni sobrescribe esa versión, ni la cuenta dueña del bucket.
- El hash va en el nombre para que dos manifiestos distintos nunca compartan nombre: si una base restaurada vuelve a usar un número, su manifiesto queda junto al original en vez de quedar como versión nueva del mismo objeto, y la diferencia se ve a simple vista.
- Si otra ancla de la misma organización tiene tomado el turno, espera como máximo 5 s (`lock_timeout`) y falla esa organización en lugar de quedarse colgada.
- Si la publicación falla, no deja el registro local de esa organización y sigue con las demás.
- No descifra nada y no escribe auditoría. Se puede correr dos veces seguidas: genera un manifiesto más, no daño.

## Precondiciones

### El bucket (una sola vez, lo hace Ops)

1. Crea en Wasabi un bucket **aparte**, no el de los respaldos, con **Object Lock habilitado al crearlo**. No se puede activar después. Wasabi exige el versionado para Object Lock.
2. Crea una política y un usuario propios para este trabajo, con **solo** `s3:PutObject` y `s3:PutObjectRetention` sobre ese bucket. Sin lectura, sin borrado y sin cambiar la configuración de bloqueo. Esta credencial es distinta de la de los respaldos, de la base y del KMS.
3. **Verifica antes de cargar datos reales** (no está confirmado en la documentación de Wasabi):
   - que una retención de 2 años en modo de cumplimiento se acepta;
   - que la política de solo escritura funciona: con esa credencial, `PutObject` responde bien y leer o borrar el objeto responde «acceso denegado»;
   - que intentar borrar una versión bloqueada falla también con la credencial raíz de la cuenta.
4. Wasabi cobra un mínimo de 90 días por objeto y la retención es de 2 años: el costo es despreciable (un objeto pequeño por organización y día), pero queda fijo durante ese plazo.

### El comando

- API compilada: `pnpm --filter @iam/api build` (genera `dist/main.anchor-audit.js`).
- Migración `0033_audit_anchors.sql` aplicada.
- Variables de entorno, en el mismo archivo de entorno que la API (lo custodia Ops; no lo copies a otro lugar):

| Variable | Qué es |
| --- | --- |
| `DATABASE_URL` | Conexión con el **rol de la aplicación** (`iam_app`). Nunca el de migraciones ni uno con `BYPASSRLS`. |
| `AUDIT_ANCHOR_S3_ENDPOINT` | Extremo del bucket, `https://s3.<región>.wasabisys.com`. |
| `AUDIT_ANCHOR_S3_REGION` | Región del bucket. |
| `AUDIT_ANCHOR_S3_BUCKET` | Nombre del bucket del paso 1. |
| `AUDIT_ANCHOR_S3_ACCESS_KEY_ID` | Credencial de solo escritura del paso 2. |
| `AUDIT_ANCHOR_S3_SECRET_ACCESS_KEY` | Su secreto. Nunca se imprime: si falta, el error solo dice el nombre de la variable. |

## Programarlo _(propuesta)_

Una vez al día:

```text
23 3 * * * cd <ruta de la API> && node dist/main.anchor-audit.js >> <ruta de registros>/anchor-audit.log 2>&1
```

La hora `03:23` evita la hora en punto y el pico de uso. Un temporizador de systemd equivale; lo importante es una ejecución diaria y conservar la salida.

## Salida y alertas

Una línea de conteos: organizaciones recorridas, ancladas y con fallo. Por cada fallo, una línea por stderr con el identificador de la organización, el nombre del error (por ejemplo `AuditAnchorPublishError (AccessDenied)`) y si la alerta quedó encolada o no. No imprime hashes, contenido ni credenciales.

- Código de salida `0`: todas las organizaciones quedaron ancladas.
- Código de salida `1`: alguna quedó sin ancla hoy. Revisa el nombre del error: `AccessDenied` apunta a la política del paso 2, `InvalidRequest` a la configuración de Object Lock del bucket, y un `TimeoutError` a la red.
- Más de 26 horas sin una línea nueva en el registro: la programación dejó de correr y la protección se degrada en silencio. Alerta por ausencia.

Si una organización queda sin ancla, el comando encola para ella una alerta de infraestructura (`integration.infra_alert`, código `job_failed`, en una transacción aparte de la del ancla). La API la entrega a la Raíz por correo, por Telegram o por ambos, según lo que eligió (`GET` y `PUT /integrations/alert-settings`; la pantalla del panel todavía no existe). La alerta solo dice que una tarea programada falló y cuándo; el motivo está en el registro. La entrega viaja por el outbox: solo sale si la API corre con `OUTBOX_WORKER_ENABLED=true`; sin él, la alerta se encola pero nunca llega. No se agrupa: cada ejecución con fallo encola otra, así que una falla que dura varios días avisa una vez al día, y volver a correr el comando a mano el mismo día repite el aviso.

La alerta no cubre dos casos, que siguen dependiendo de la vigilancia del registro:

- que el comando no llegue a correr (cron detenido, base caída): no hay quien encole la alerta;
- que tampoco se pueda encolar la alerta: la línea de stderr dice «SIN alerta».

## Verificación

- Tras la primera ejecución, la línea de conteos aparece con «organizaciones con fallo: 0» y el bucket tiene un objeto por organización.
- Con la credencial de operación (no la del trabajo), intenta borrar uno de esos objetos: debe fallar.
- La comparación diaria entre el bucket y la base (que el evento anclado sigue existiendo con ese `hash` y que la cadena no retrocede) es el verificador del TODO H1, que todavía no existe.

## Rollback

Desactiva la entrada del cron. Los manifiestos ya publicados **no se pueden borrar** hasta que venza su retención: es la garantía buscada, no un error. El registro local `audit_anchors` tampoco se borra: el rol de la aplicación no tiene permiso y la tabla rechaza borrados incluso del dueño.

## No verificado

- Que Wasabi acepte las sumas de verificación que agrega el SDK de AWS v3 en `PutObject`. Si el primer ensayo falla con un error de suma de verificación, hay que ajustar el cliente.
- Los tres puntos del paso 3 de las precondiciones.

## Historial de ensayos

_Sin ensayos todavía._
