# ADR 0042: Anclaje externo periódico de la cadena de auditoría

- **Estado**: Propuesta. Borrador de Ingeniería para `TODO.md` F2; no es una decisión hasta que una persona lo ratifique.
- **Fecha**: 2026-10-29
- **Referencias**: [ADR 0016](0016-append-only-audit-hash-chain.md) (cadena de hashes); [ADR 0023](0023-audit-advisory-lock-and-long-transactions.md) (lock y tiempos); [ADR 0024](0024-audit-retention-vs-revoke-delete.md) (retención y archivo inmutable); [ADR 0020](0020-reference-cloud-aws.md) (AWS solo para el KMS); [ADR 0038](0038-purge-expired-ephemeral-rows.md) (trabajos programados); [ADR 0039](0039-single-instance-until-redis.md) (instancia única); [`docs/database.md`](../database.md) §8.2 y §8.5; [`docs/threat-model.md`](../threat-model.md) (fila "Reescritura de la historia"); `TODO.md` F2, H1 y R1.

## Resumen

**Recomendación (confianza media-alta, alrededor de 75 %):** un trabajo programado cada hora publica en almacenamiento de solo escritura (Object Lock en modo de cumplimiento) un manifiesto con el último `seq` y `hash` de cada organización. La clave en el KMS para firmar cada evento se descarta. Queda abierto **dónde** se publica, porque el ADR 0020 limita AWS al KMS.

## Contexto

Lo que protege hoy la cadena, verificado en el código:

- `audit_events` guarda `prev_hash` y `hash`. El `hash` es un SHA-256 **sin clave** de una lista JSON de catorce campos (`audit_event_hash`, `db/migrations/0006_governance_audit.sql` líneas 134 a 152). Lo calcula el disparador `audit_events_chain`, que toma el advisory lock de la organización (línea 162) y sobrescribe lo que envíe el cliente (líneas 154 a 183).
- La aplicación (`iam_app`) solo puede insertar y leer: `UPDATE`, `DELETE` y `TRUNCATE` están revocados y además hay disparadores que los rechazan (líneas 185 a 197 y 235 a 239). Así que **un fallo de la aplicación no reescribe la historia**.
- Quien sí puede: una persona con rol de dueño de la tabla o superusuario en el servidor de PostgreSQL. Puede desactivar los disparadores, modificar eventos y **recalcular toda la cadena**, porque el algoritmo es público y no hay secreto. `audit_verify_chain()` (líneas 203 a 224) diría "íntegra". Esta es la premisa de `TODO.md` F2 y se confirma.
- La propia migración lo reconoce: borrar los eventos **más recientes** no se detecta, y lo que ancla la cola es una "exportación externa inmutable (S3 Object Lock)" (líneas 199 a 202; `docs/database.md` §8.2). Esa exportación **no existe**: tampoco existe la verificación diaria (`docs/observability.md` línea 20, `TODO.md` H1).
- Hoy hay una sola instancia de la API (ADR 0039) y los trabajos programados son procesos de un solo disparo con cron del anfitrión, como `purge-expired` (cada hora, minuto 17, `docs/runbooks/purge-expired.md`; `apps/api/src/main.purge-expired.ts`).
- AWS se usa solo para el KMS; PostgreSQL y la API corren en un servidor dedicado con Dokploy (adenda del ADR 0020). Cualquier destino en S3 es un servicio y una identidad nuevos.

Lo que **ninguna** de las opciones resuelve: un evento falso insertado legítimamente por una aplicación comprometida. Eso se mitiga con autorización y alertas, no con la cadena.

## Opciones

### A. Sellar cada evento con HMAC cuya clave está en el KMS

- **Cómo sería**: la clave no puede vivir en la base (quien escribe la tabla la leería). PostgreSQL no puede llamar al KMS desde el disparador, así que el HMAC lo calcularía la aplicación y habría que renunciar a la regla de que "la aplicación nunca calcula el hash" (`docs/backend.md` §5.2).
- **A favor**: cierra la brecha incluso sin copia externa; quien solo toca la base no puede falsificar.
- **En contra**:
  - La llamada al KMS caería **dentro del lock** (ADR 0023). El adaptador documenta que KMS responde en "decenas de milisegundos" (`aws-key-management.ts` línea 26, estimación del código, no medida) y el ADR 0023 midió unos 8 a 10 ms de cola por escritura bajo contención. Sumar decenas de ms por evento multiplicaría la cola por varias veces; no está medido y se debe medir antes de elegirla.
  - La disponibilidad del KMS pasaría a ser la de toda acción sensible (la auditoría falla cerrada).
  - Rehace la cadena existente (el formato cambia) y hay que versionar la clave de HMAC para poder rotarla sin perder verificabilidad.
  - Sigue sin detectar el borrado de la cola ni la restauración de una copia antigua de la base.
  - Una aplicación comprometida con acceso al KMS sí puede firmar eventos falsos.

### B. Ancla externa periódica en almacenamiento inmutable (recomendada)

- **Cómo sería**: cada hora, un trabajo recorre las organizaciones (`auth.list_organization_ids()` y el contexto de organización, mismo molde del ADR 0038), lee `seq` y `hash` del último evento de cada una y publica **un manifiesto** con: fecha, número de manifiesto, hash del manifiesto anterior y la lista `(organización, seq, hash)`. El almacenamiento no permite sobrescribir ni borrar durante la retención (≥ 2 años según el ADR 0024).
- **A favor**:
  - Detecta lo que hoy es invisible: borrar la cola, reescribir y recalcular la cadena (el hash recalculado ya no coincide con el anclado) y restaurar una base antigua.
  - **No toca la ruta de escritura**: solo lee, sin el advisory lock; el ADR 0023 queda intacto.
  - No cambia el formato de la cadena ni requiere migración.
  - Ya está en el plan (`plan.md` líneas 613 y 930) y en `docs/database.md` §8.5, que además lo necesita para retirar particiones (tabla `audit_exports`, punto de control).
- **En contra**:
  - Hay una ventana: lo reescrito **después** del último ancla y antes del siguiente no se detecta hasta el ancla siguiente (hasta una hora con la frecuencia propuesta). Si la manipulación ocurre antes de que se publique el ancla siguiente, ese ancla ya registraría lo falso; por eso importa que la frecuencia sea corta y que la credencial de publicación sea distinta de la de la base.
  - Hay que operar un destino nuevo, con una credencial de solo escritura que la API o el anfitrión conservan. Si el atacante tiene root en el anfitrión, puede publicar manifiestos falsos **nuevos**, pero no borrar los anteriores; el versionado y la comparación con el ancla previa lo dejan a la vista.
  - Si el trabajo se detiene en silencio, la protección se degrada sin que nadie lo note. Hace falta una alerta si pasan más de dos horas sin manifiesto.

### C. Ambas: ancla periódica más firma del manifiesto con el KMS

- **Cómo sería**: B, y además cada manifiesto lleva una firma (MAC) con una clave de KMS propia, distinta de la que envuelve las DEK.
- **A favor**: prueba que el manifiesto lo produjo la plataforma y no alguien con permiso de escritura en el destino.
- **En contra**: una clave y una política de KMS más, y un permiso más para el rol de la aplicación, para una amenaza que el modo de cumplimiento del almacenamiento ya cubre en buena parte. No añade protección contra el borrado de la cola.

## Recomendación (propuesta)

**Opción B, con la opción C como mejora posterior si el análisis de amenazas la pide.** Rechazar A: es la más cara en el punto más sensible (el lock) y no sustituye a la copia externa.

Reglas que se derivan si se acepta:

1. **Frecuencia**: cada hora, junto al cron de `purge-expired` (otro minuto). Un ancla adicional inmediata tras acciones críticas (restablecimiento de la Raíz, rotación por incidente) queda como mejora opcional.
2. **El trabajo no está en la transacción de negocio**: si falla, no bloquea escrituras; alerta por ausencia de manifiestos y se reintenta. Es idempotente: dos ejecuciones solapadas producen manifiestos repetidos, no daño (con instancia única y un solo cron no se espera solape).
3. **Verificación diaria** (que es H1): por organización, `audit_verify_chain()` y, además, para cada manifiesto del periodo, comprobar que existe el evento con ese `seq` y ese `hash` y que el último `seq` actual no es menor que el anclado. Cualquier diferencia es una alerta de seguridad. También se verifica la cadena de manifiestos.
4. **Credencial**: la que publica puede solo escribir objetos nuevos; no lee ni borra. Es distinta de la de la base y del KMS.
5. **Interacción con el ADR 0024**: los manifiestos son los puntos de control que necesita el retiro de particiones; no se retira una partición sin un ancla que cubra su último evento.
6. **Estado de la documentación**: `docs/database.md` §8.2 y el comentario de la migración ya prometen este mecanismo; se actualizan al implementarlo, no antes.

## Consecuencias (si se acepta)

- **Positivas**: se cierra la brecha del administrador de base de datos sin costo en la ruta de escritura; es la base de R1 y del retiro de particiones.
- **Negativas o costos**: un destino y una credencial nuevos que operar; ventana de detección de hasta una hora; la protección depende de que el trabajo siga corriendo.
- **Implementación**: auditoría es ruta protegida. Requiere encargo humano explícito, revisión adversarial con dos revisores ciegos y pruebas revisadas por una persona. Probablemente no requiere migración (solo lectura), salvo que se decida guardar un registro local de lo anclado (`audit_exports`, que sirve para el control de particiones, no como evidencia).
- **Verificación**: prueba que altera un evento recalculando la cadena y comprueba que la verificación contra el manifiesto lo detecta; prueba de borrado de la cola; mutación manual (quitar la comparación con el ancla y comprobar que alguna prueba falla).

## Preguntas abiertas para una persona

1. **¿Dónde se publica?** Es la pregunta clave. Opciones: S3 con Object Lock en AWS (agrega un servicio y una identidad al ADR 0020; idealmente en una cuenta aparte), o almacenamiento compatible con S3 del proveedor del servidor (**no se verificó** que soporte bloqueo de objetos en modo de cumplimiento). Un destino sin inmutabilidad real no sirve.
2. ¿Una hora es una ventana aceptable? ¿O basta una vez al día, o se quiere cada pocos minutos? El costo es despreciable en objetos (24 al día); lo que cambia es cuánto tarda en notarse una manipulación.
3. ¿Quién recibe la alerta de manifiesto ausente o discrepante y qué hace? Depende de la observabilidad que aún no existe.
4. ¿Se justifica la opción C (firma con KMS)? Depende de quién se considere el atacante: con acceso al anfitrión, la firma tampoco lo detiene.

## No verificado

- Soporte de Object Lock en el destino alternativo al de AWS.
- Latencia real de una llamada de firma al KMS desde el servidor (la cifra del código es una estimación).
- Que el modo de cumplimiento permita la retención necesaria con el presupuesto disponible (política C9 pendiente con el área legal).
