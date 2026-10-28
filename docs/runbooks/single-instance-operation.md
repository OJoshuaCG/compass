# Runbook: Operar con una sola instancia (hasta incorporar Redis)

> **Borrador, pendiente de ensayo antes de producción.** Describe una restricción vigente, no un procedimiento de emergencia. Deja de aplicar cuando los contadores de intentos pasen a Redis (ver [`docs/handoff.md`](../handoff.md), sección 4).

Referencias: [`docs/backend.md`](../backend.md) §10 y §16; [ADR 0039](../adr/0039-single-instance-until-redis.md) (decisión de instancia única); [ADR 0026](../adr/0026-atomic-failed-attempt-counting.md); [`docs/threat-model.md`](../threat-model.md) §4.1.

## Objetivo

Mantener efectivos el bloqueo por intentos fallidos y el límite por dirección de red mientras viven en la memoria de cada instancia de la API.

## Cuándo usarlo

- En todo despliegue, hasta que exista el almacén compartido de contadores.
- Antes de escalar horizontalmente, de poner un balanceador con varias réplicas o de activar el autoescalado: no hacerlo.

## Precondiciones

- Se entiende el motivo: los contadores de intentos fallidos (por correo en el ingreso y por usuario en el segundo factor) y el límite de 60 peticiones por minuto por IP no se comparten entre instancias y un reinicio los borra. Con N instancias, quien ataca obtiene en la práctica N veces los intentos antes del bloqueo.
- Hoy la API no arranca con `NODE_ENV=production`, porque el adaptador de claves local se niega y todavía no existe el del proveedor de nube (decisión de proveedor pendiente, ADR 0020). Este runbook describe el despliegue objetivo.

## Pasos

1. Despliega exactamente **una** réplica de la API. Sin autoescalado y con un mínimo y un máximo de 1.
2. Usa una estrategia de actualización que detenga la instancia vieja antes de arrancar la nueva. Una superposición de dos instancias, aunque breve, divide los contadores.
3. Aplica las migraciones antes de arrancar la API, con el rol de migraciones (`main.migrate`).
4. Si hay un balanceador o proxy de confianza delante, define `TRUST_PROXY` con la lista de IP o rangos CIDR del balanceador (o `1` si hay un solo salto, solo cuando la API es inalcanzable sin pasar por el balanceador: los saltos no validan al par directo) para que el límite por IP use la dirección real del cliente. Sin proxy déjalo en `false`. Evita `true`: confía en toda la cadena. Antes de activarlo confirma que el balanceador reemplaza `X-Forwarded-For` y que la API no es alcanzable directo; si no, cualquiera falsifica su IP y evita el límite ([`backend.md`](../backend.md) §6.4).
   La API lo hace cumplir: al arrancar toma un candado consultivo de PostgreSQL sobre una conexión dedicada (aplicación `iam-api-single-instance-guard`). Si otra instancia ya lo tiene, la nueva termina con el error `RUNTIME.SECOND_INSTANCE`. Si la instancia viva pierde esa conexión, se detiene sola (el candado ya no está garantizado). Por eso una actualización superpuesta no arranca: detén la vieja primero. Un latido cada 10 s comprueba que la conexión sigue sosteniendo el candado, así que un corte de red que no cierra la conexión también acaba deteniendo la instancia.
   - `DATABASE_URL` debe ser una conexión **directa** a PostgreSQL. Detrás de un balanceador de conexiones en modo transacción (PgBouncer) el candado de sesión no protege nada: la API lo detecta y no arranca (`RUNTIME.LOCK_UNVERIFIABLE`).
   - La instancia nueva falla de inmediato si la vieja aún figura viva (por ejemplo tras un `SIGKILL`, hasta que PostgreSQL note el socket muerto). Configura al supervisor para reintentar el arranque con espera en vez de dejar el servicio caído.
5. Registra en el inventario del despliegue que la restricción existe, quién la levanta y que se retira al incorporar Redis.

## Verificación

- Hay una sola réplica activa de la API.
- Arrancar una segunda instancia contra la misma base falla de inmediato con `RUNTIME.SECOND_INSTANCE`. El candado solo ve instancias que comparten base de datos: no sustituye las comprobaciones del despliegue (réplicas en 1, sin autoescalado).
- Tras 10 intentos fallidos de ingreso con el mismo correo, el siguiente se bloquea durante 15 minutos (se puede comprobar con una cuenta de prueba).
- La auditoría registra los intentos fallidos y los bloqueos.

## Rollback y límites

- Un reinicio de la API borra los contadores: quien estaba bloqueado puede intentar de nuevo. Es una limitación conocida. Ante un ataque en curso, revisa la auditoría y bloquea el origen en el borde (proxy o firewall) antes de reiniciar.
- Si fue inevitable tener varias instancias, considera el límite de intentos efectivo multiplicado por el número de instancias y vigila la auditoría de ingresos fallidos.
- La caída de la única instancia es una caída del servicio: la disponibilidad requerida es una decisión pendiente del equipo.

## Responsables

| Rol (propuesto) | Responsabilidad |
| --- | --- |
| Operaciones | Mantiene una sola réplica y la estrategia de actualización |
| Ingeniería | Retira la restricción al incorporar Redis y actualiza este runbook |

## Historial de ensayos

| Fecha | Quién | Resultado | Cambios al runbook |
| --- | --- | --- | --- |
| (sin ensayar) | | | |
