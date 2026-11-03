# Comandos: restaurar respaldo (borrador)

Completa los pasos del runbook [restore-backup](../runbooks/restore-backup.md) que dicen "Comando: por definir". Leyenda y advertencias en el [README](README.md).

> **Antes de usarlo.** El runbook supone PITR administrado; la decisión C1 es PostgreSQL dedicado con `pg_dump` y copias en Wasabi. Los pasos de abajo siguen la decisión C1. Falta fijar la frecuencia del volcado, que es el RPO real.

## Pasos

| Paso del runbook | Estado | Comando o razón |
| --- | --- | --- |
| 1. Fijar el punto de recuperación | **Propuesto** | Con volcados, el punto es la hora del archivo. Listar los disponibles (Wasabi habla el protocolo de S3): ver bloque A. |
| 2. Restaurar la base | **Propuesto** | Primero los roles del servidor, después la base: ver bloque B. |
| 3. Aplicar migraciones pendientes | **Existe** | `MIGRATION_DATABASE_URL='postgres://iam_migrator:<secreto>@<host>/<base>' node apps/api/dist/main.migrate.js` ([`deployment.md`](../deployment.md) §2.5). |
| 4. Redis y secretos de infraestructura | **Existe**, con una salvedad | Redis aún no existe: los contadores viven en memoria (handoff §8, A8), así que no hay nada que restaurar. Los secretos de infraestructura se reinyectan como variables de entorno en Dokploy con la plantilla `.env.dokploy.example` ([`deployment.md`](../deployment.md) §2.6). |
| 5. Verificar el KMS y desplegar | **Existe** | Se despliega desde Dokploy ([`deployment.md`](../deployment.md) §2.6 y §2.7). El acceso al KMS se comprueba solo: al arrancar, la API genera y abre una clave desechable y **no arranca** si falla (L1a, TODO). |
| 9. Destruir el entorno del simulacro | **Propuesto** | Ver bloque C. Es destructivo: lo ejecuta una persona, tras confirmar el servidor. |

## Bloque A. Listar volcados

```bash
aws s3 ls "s3://<bucket>/<prefijo>/" \
  --endpoint-url "https://s3.<region>.wasabisys.com"
```

## Bloque B. Restaurar

Los roles (`iam_app`, `iam_migrator` y los demás) viven en el servidor, no dentro de la base, y no vienen en un volcado normal de una base. Hace falta un volcado aparte de los roles, que además contiene hashes de contraseñas: se guarda cifrado igual que los volcados.

```bash
# Al respaldar (junto con cada volcado de la base):
pg_dumpall --globals-only --host=<host> --username=<admin> > globals.sql

# Al restaurar, en el servidor destino:
psql "postgres://<admin>@<host-destino>/postgres" --file=globals.sql
createdb --host=<host-destino> --username=<admin> <base>
pg_restore --exit-on-error \
  --dbname="postgres://<admin>@<host-destino>/<base>" <archivo>.dump
```

No uses `--no-owner` ni `--no-privileges`: los dueños de las funciones definidoras (por ejemplo, las de `auth.*`, dueñas `iam_auth_reader`) y los permisos son parte del aislamiento por organización ([`database.md`](../database.md)).

## Bloque C. Destruir el entorno del simulacro

```bash
# Confirma primero el host: este comando borra la base sin preguntar.
dropdb --host=<host-del-simulacro> --username=<admin> <base-del-simulacro>
```

## Checklist antes de ensayar

- [ ] Frecuencia del volcado decidida y RPO escrito en el plan.
- [ ] Volcados y `globals.sql` cifrados antes de subirse a Wasabi.
- [ ] El destino del simulacro es un servidor aparte, nunca el de producción.
- [ ] Después de restaurar, el simulacro abre un secreto con la clave (TODO Q2).
