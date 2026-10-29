# ADR 0024: Retención de auditoría frente a `REVOKE DELETE`

- **Estado**: Propuesta
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Auditoría" (append-only, retención de 2 años en línea, exportación a almacenamiento inmutable) y "Decisiones pendientes del equipo" (política de retención); [`docs/backend.md`](../backend.md) §6.1 y §16; [ADR 0016](0016-append-only-audit-hash-chain.md).

## Contexto

El rol de la aplicación solo tiene `INSERT` y `SELECT` sobre `audit_events` (`UPDATE` y `DELETE` revocados) y la cadena de hashes enlaza cada evento con el anterior. El plan fija una retención de **2 años en línea**, más en el archivo. Sin `DELETE` no hay forma de expirar eventos antiguos con el rol de la aplicación, y borrar filas intermedias de una cadena rompería su verificación. La política de retención aún está pendiente de validación con el área legal.

## Opciones

1. **Particionado por tiempo** (recomendada). `audit_events` particionada por mes u organización y fecha; las particiones fuera de la ventana en línea se exportan al archivo inmutable (S3 con Object Lock) y se separan (`DETACH`) o se eliminan por el rol de migraciones o de archivado, no por la aplicación. La cadena se ancla: cada partición cierra con un hash de cierre que la siguiente toma como `prev_hash` inicial verificable contra el archivo.
2. **Rol de archivado dedicado**: un tercer rol, usado solo por un job de archivado, con `DELETE` limitado a eventos ya exportados y verificados, y con anclaje del hash del último evento retirado _(inferida del plan)_. Más simple de introducir, pero deja `DELETE` fila por fila en una tabla append-only y requiere políticas estrictas.
3. **No expirar en línea** y mantener todo en la base de datos: sin riesgo para la cadena, pero crecimiento sin límite y contradice la retención de 2 años en línea. Solo viable si el volumen es bajo _(inferida del plan)_.

## Recomendación

Opción 1, con una verificación de la cadena que pueda iniciar desde un ancla exportada (el job diario de verificación debe saber dónde empieza la cadena en línea). Los pasos exactos de la exportación, el cierre de partición y la verificación del archivo deben quedar en un runbook antes del gate de producción. El plazo de retención final depende de la validación legal (decisión pendiente en el plan).

Esta es una recomendación para decidir, no una decisión.

## Decisión parcial del dueño (2026-10-28)

- **Retención en línea: 6 meses** (en lugar de los 2 años que traía el plan, que eran un valor de partida sin razón documentada). Con unas 100 personas usuarias el volumen es bajo, así que el plazo no se fija por espacio sino por lo que hace falta para investigar un incidente descubierto tarde.
- **Archivo exportado e inmutable: al menos 2 años**, pendiente de validar con el área legal antes de producción.
- **Sigue abierto**: la elección de la opción de expiración (la recomendada es el particionado, opción 1), la granularidad de partición, el formato del hash de cierre y dónde vive el archivo inmutable. Por eso el estado se mantiene en "Propuesta".

## Consecuencias (si se acepta la recomendación)

- **Positivas**: expiración eficiente sin `DELETE` desde la aplicación; la cadena y el archivo siguen siendo verificables.
- **Negativas o costos**: complejidad operativa de particiones y anclas; la verificación diaria debe soportar varios segmentos; el esquema de `audit_events` y su RLS deben diseñarse con particionado desde la migración inicial para evitar una migración costosa después.
- **Pendiente**: granularidad de partición, formato del hash de cierre y política de retención validada con el área legal.

## Opciones pendientes (borrador 2026-10-29)

Borrador de Ingeniería para `TODO.md` F1. **No cambia el estado (sigue en Propuesta) ni sustituye la ratificación humana**: auditoría es ruta protegida. Todo lo marcado "verificado" se leyó en `db/migrations/0006_governance_audit.sql`, `db/migrations/0017_audit_actor_action_index.sql`, `db/tests/rls.test.ts` y `docs/database.md` §8; nada se ejecutó contra una base de datos.

### Resumen

**Recomendación (confianza alrededor de 70 %):** particionar `audit_events` **por mes sobre `created_at`, con una sola serie global** (no una partición por organización), y retirar las particiones de más de 6 meses con una función privilegiada que exige un ancla externa verificada y un punto de control por organización. Queda sin resolver **dónde vive el archivo inmutable** (es la pregunta clave, la misma del [ADR 0042](0042-audit-chain-external-anchoring.md)).

La confianza no es mayor por dos razones: el particionado no se probó contra la tabla real y, sobre todo, hay un riesgo de la cadena (el punto 1 de abajo) que la propuesta anterior no mencionaba.

### Lo que el código impone (verificado)

| Hecho | Dónde | Por qué importa aquí |
| --- | --- | --- |
| `DELETE`, `UPDATE` y `TRUNCATE` están revocados a la aplicación, a `PUBLIC` y al dueño, y además hay disparadores que los rechazan | 0006, líneas 185 a 197 y 235 a 239 | Ninguna fila se puede borrar, ni por el dueño. Retirar una partición entera es DDL (`DETACH` o `DROP`), no `DELETE`, y no activa el disparador de filas; lo permite el dueño de la tabla, no `iam_app` |
| El disparador `audit_events_chain` toma el lock por organización y lee **el último evento de la organización en toda la tabla** (`order by seq desc limit 1`) para calcular `seq` y `prev_hash`; si no hay ninguno, empieza en `seq = 1` con 32 ceros | 0006, líneas 156 a 183 | Si una organización quedara sin eventos en línea, **su cadena reiniciaría en 1** y chocaría con lo archivado (ver punto 1) |
| `audit_verify_chain()` exige que la primera fila tenga `seq = 1` y `prev_hash` de 32 ceros; si no, reporta ruptura en esa fila | 0006, líneas 203 a 224 | Tras expirar eventos, la verificación diaria diría "rota" siempre, hasta que sepa arrancar desde un punto de control |
| `unique (organization_id, seq)` y `primary key (id)` | 0006, líneas 6 a 29 | En una tabla particionada toda restricción única debe incluir la columna de partición (`created_at`); se pierde la unicidad de `seq` a nivel de base y queda solo la garantía del lock |
| La tabla tiene `ENABLE` y `FORCE` RLS con dos políticas (`SELECT` e `INSERT`) | 0006, líneas 226 a 235 | Ver (b) sobre particiones |
| El volumen es bajo (unas 100 personas, menos de 20 clientes) | `CLAUDE.md`, ADR 0020 | La expiración no se justifica por espacio sino por política; la complejidad debe ser proporcional |
| Hoy no existen `iam_audit_archiver`, `audit_exports` ni `audit_chain_checkpoints`; solo están descritos en `docs/database.md` §8.5 | búsqueda en `db/`, `apps/` y `docs/` | Todo lo de abajo es diseño, no código |

### (a) Cómo salen de la tabla en línea las filas de más de 6 meses

| Opción | Cómo funciona | A favor | En contra |
| --- | --- | --- | --- |
| **A1. Particionar y retirar la partición** (`DETACH` y luego `DROP`, por un rol privilegiado) | Se retira el mes completo, nunca fila por fila. `iam_app` no gana ningún privilegio nuevo | Es lo que el ADR ya recomendaba; no toca el modelo de "nadie borra filas"; el costo de retirar es constante; la cadena de lo que queda no cambia | Hay que migrar la tabla a particionada (ver (b)); un rol y una función nuevos que revisar; la ventana real en línea es de 6 a 7 meses, porque se retira el mes completo cuando todo él supera los 6 meses |
| **A2. Exportar y `TRUNCATE` con punto de control** | Se exporta todo, se guarda el hash final y se vacía la tabla entera | Sin particionar | `TRUNCATE` vacía **toda** la tabla, no solo lo viejo: no sirve para una ventana móvil. Descartada |
| **A3. Archivado suave** (marcar filas como archivadas y ocultarlas) | Una columna o tabla auxiliar indica que la fila ya salió | Sin DDL | Exige `UPDATE` o una tabla paralela sobre una tabla append-only (rompe el principio de 0016); las filas **siguen ocupando la base**, así que no "salen" de la tabla en línea. Descartada |
| **A4. Rol con `DELETE` fila por fila** (la opción 2 original) | Un tercer rol con `DELETE` limitado a lo exportado | Fácil de introducir | Debilita el disparador y la revocación que hoy protegen contra el dueño; requiere políticas y disparadores nuevos sobre cada fila. No recomendada |

**Recomendación: A1.** Es la única que cumple a la vez "salen del conjunto en línea" y "la aplicación sigue sin poder borrar". Con el volumen actual (una organización, decenas de personas) la alternativa A3 sería más simple de escribir pero deja la historia en la base, que es justo lo que se quiere acotar.

### (b) Particionado: por mes y global, o por organización

**Recomendación: por mes sobre `created_at`, serie global.** Razones verificadas:

- **Efecto sobre el lock y `seq` ([ADR 0023](0023-audit-advisory-lock-and-long-transactions.md))**: el lock se deriva del identificador de la organización (`hashtextextended('audit_events:' || organization_id, 0)`), no de la tabla ni de la partición. Particionar por mes **no cambia** la serialización: dos escritores de la misma organización siguen esperándose aunque sus filas caigan en particiones distintas. La consulta "último evento de la organización" sin filtro de fecha recorre el índice de cada partición vigente; con 7 particiones es poco trabajo, pero **no se ha medido**. Hay que repetir `db/tests/audit-latency.test.ts` sobre la tabla particionada antes de aceptar.
- **Por organización sería peor**: multiplicaría las particiones por cada cliente nuevo (hoy menos de 20, pero crece), sin ventaja de contención (el lock ya es por organización) y complicaría la retirada, que es por fecha. Solo valdría si se quisiera retirar una organización completa; eso es otro caso (baja de un cliente) y no el de esta decisión.
- **Pérdida de la unicidad de `seq` en la base**: `unique (organization_id, seq)` pasaría a `(organization_id, seq, created_at)`, que ya no impide dos eventos con el mismo `seq`. La garantía real queda en el lock más el disparador. `audit_verify_chain()` sí lo detectaría (comprueba `seq` consecutivos), pero **la prueba de concurrencia de `db/tests/audit.test.ts` pasa a ser la única red** y debe ampliarse. Un revisor humano debe aceptar este cambio de garantía de forma explícita.
- **La migración 0006 no se edita**: hace falta una migración nueva. Una tabla ya creada no se convierte en particionada con `ALTER`. Caminos posibles (ninguno probado):
  1. Crear una tabla particionada nueva y **adjuntar la tabla actual como partición de arranque** (`ATTACH PARTITION` con un rango que cubra sus filas). Conserva los hashes existentes. Hay que renombrar y reconstruir la clave primaria y los índices únicos con `created_at`.
  2. Copiar las filas a la tabla nueva. **No es seguro tal cual**: el disparador `audit_events_chain` sobrescribe `seq`, `prev_hash`, `created_at` y `hash` al insertar, así que una copia por `INSERT` recalcularía la cadena con otras fechas y rompería la relación con lo anclado. Solo sería válido con el disparador desactivado durante la copia, lo que es una operación sobre una ruta protegida.
  3. Como la bóveda aún no tiene datos reales (fase 1b no iniciada), también cabría recrear la tabla vacía; solo es aceptable si **no hay** eventos que conservar, y eso lo confirma una persona.
- **`FORCE RLS` y particiones**: las políticas de la tabla padre se aplican cuando se consulta **por el padre**; una consulta directa a una partición usa las políticas de **esa** partición, no las del padre. Por eso cada partición nueva debe nacer con `ENABLE` y `FORCE ROW LEVEL SECURITY`, sus dos políticas y los `REVOKE` de `UPDATE`, `DELETE` y `TRUNCATE`, y **sin `GRANT` directo a `iam_app`** (los privilegios se otorgan al padre). Los disparadores de fila `BEFORE INSERT` y de `UPDATE o DELETE` se heredan; el de `TRUNCATE` es de sentencia y solo cubre la tabla padre, así que una partición se podría vaciar directamente: por eso la partición debe ser propiedad del rol de migraciones, no de la aplicación, y el privilegio `TRUNCATE` debe revocarse en cada partición. Esto es comportamiento de PostgreSQL conocido pero **no se probó aquí**: debe cubrirlo una prueba de aislamiento escrita o revisada por una persona.
- **La prueba de RLS actual descubriría cada partición como una tabla de organización nueva**: `db/tests/rls.test.ts` toma todas las relaciones `r` y `p` con columna `organization_id` y compara con `PHASE1_TENANT_TABLES`. Una partición mensual rompería esa comparación; hay que excluir las particiones (`relispartition`) y comprobar RLS en ellas con una verificación aparte.
- **Creación de particiones por adelantado**: si no existe la partición del mes, el `INSERT` falla. Como la auditoría falla cerrada, **un mes sin partición bloquearía toda acción sensible**. Hace falta una partición `DEFAULT` o un trabajo que cree el mes siguiente con alerta si falta. Es un riesgo operativo nuevo que hoy no existe.

### Riesgo de cadena que la propuesta original no cubría

1. **Una organización sin eventos en la ventana reiniciaría su `seq`.** Una organización inactiva 7 meses tendría todas sus filas en particiones ya retiradas; su siguiente evento saldría con `seq = 1` y 32 ceros, repitiendo números que existen en el archivo y rompiendo el empalme con lo anclado. Dos remedios, no excluyentes:
   - la función de retiro **rechaza** retirar una partición si contiene el último evento de alguna organización; o
   - el disparador, cuando no encuentra evento, toma `seq` y `hash` de `audit_chain_checkpoints` en lugar del génesis (modifica un disparador protegido: nueva migración con `CREATE OR REPLACE` y revisión de dos jueces).

   **Recomendación: ambos**; el primero es defensa inmediata y barata, el segundo cierra el caso de forma definitiva.
2. **`audit_verify_chain()` debe aprender a arrancar desde un punto de control.** Hoy solo conoce el génesis. Con puntos de control, el primer evento en línea debe tener `prev_hash` igual al hash guardado y `seq` igual al guardado más uno.
3. **El ADR 0031 exige conservar al menos una hora de eventos** para el límite de revelaciones; con 6 meses queda cubierto de sobra.
4. **`docs/database.md` §8.5 sigue diciendo que la función solo retira particiones de "más de 2 años"**. Con la decisión del 2026-10-28 el plazo en línea es de 6 meses y el de 2 años es del archivo; hay que corregir ese texto cuando se ratifique la opción (no se editó aquí para no mezclar documentos de diseño sin decisión).

### (c) Qué debe contener la exportación para que la cadena siga verificable

Sin esto, tras la expiración nadie podría demostrar que lo archivado y lo que queda en línea son la misma historia. Cada paquete de exportación, por partición retirada, debe incluir:

| Contenido | Para qué sirve |
| --- | --- |
| **Todas las filas completas** con `id`, `organization_id`, `seq`, `created_at` (con microsegundos), `actor_id`, `action`, `target_type`, `target_id`, `outcome`, `reason_code`, `ip`, `request_id`, `metadata`, `prev_hash` y `hash`, en orden `(organization_id, seq)` | Permite **recalcular** cada hash: el hash se calcula sobre esos catorce datos (`audit_event_hash`). Si falta uno, esa fila no se puede comprobar |
| **Por organización, el primer y el último `seq` y `hash` de la partición**, y el `prev_hash` del primero | Es el empalme: el último hash de un mes debe ser el `prev_hash` del primer evento del siguiente (en línea o archivado) |
| **El punto de control**: `(organización, seq, hash)` del último evento retirado | Es lo que guarda `audit_chain_checkpoints` y desde donde arranca la verificación en línea |
| **La versión del algoritmo del hash** (hoy la lista JSON de catorce campos) | Si el formato cambia en el futuro (por ejemplo, con el HMAC del ADR 0042, opción A), el verificador del archivo debe saber qué fórmula aplicar a cada rango |
| **Un manifiesto con la huella del paquete** y el hash del manifiesto anterior | Une los paquetes entre sí y detecta que falte uno |

Relación con el [ADR 0042](0042-audit-chain-external-anchoring.md): el ancla horaria del 0042 publica el último `seq` y `hash` por organización; **el punto de control del retiro es el mismo dato**. Se recomienda que el manifiesto del 0042 **sea** la fuente del punto de control, y que la función de retiro exija que exista un ancla publicada que cubra el último evento de la partición (regla 5 del 0042). Así hay un solo mecanismo y no dos. Consecuencia: **este ADR no se puede implementar antes que el 0042**, o al menos no antes de decidir dónde se publica.

**Lo que la verificación del archivo debe hacer**, por paquete: recalcular el hash de cada fila, comprobar que los `seq` son consecutivos y que cada `prev_hash` es el hash anterior, que el primer `prev_hash` coincide con el último hash del paquete anterior (o 32 ceros si es el primero), y que la huella del paquete coincide con la del manifiesto anclado. Un runbook debe describirlo (el ADR ya lo pedía) y debe ejecutarse **al menos una vez en un simulacro** antes del gate de producción.

### Consecuencias de la recomendación

- **Positivas**: la expiración no requiere `DELETE`; la aplicación no gana privilegios; el costo de retirar es constante; la verificación y el archivo comparten un solo punto de control con el ADR 0042.
- **Negativas o costos**: migración sobre una ruta protegida (tabla, índices, disparador y verificador); se pierde la unicidad de `seq` a nivel de base; nuevo riesgo operativo (partición faltante bloquea la auditoría); un rol, una función y dos tablas nuevas que revisar; pruebas de RLS, de concurrencia y de latencia que repetir sobre la tabla particionada.
- **Implementación**: encargo humano explícito, revisión adversarial con `jd-judge-a` y `jd-judge-b` sobre el mismo alcance congelado, pruebas de autorización, criptografía y aislamiento escritas o revisadas por una persona, y la mutación manual (quitar la exigencia del ancla y comprobar que una prueba falla).

### Preguntas para una persona

**Área legal**

1. ¿Es suficiente un archivo de **al menos 2 años** para todos los tipos de evento, o hay alguno (accesos a credenciales, cambios de permisos) con un plazo mayor?
2. ¿Hay datos personales en los eventos (`ip`, `actor_id`, `metadata`) que **obliguen a borrarlos** antes de los 2 años a petición de una persona? Si la respuesta es sí, el archivo inmutable choca con ese derecho y hay que decidirlo antes de elegir el destino.
3. ¿El archivo debe poder entregarse a un tercero (auditor o autoridad) y en qué formato?

**Operación**

4. **Pregunta clave: ¿dónde vive el archivo inmutable?** Es la misma del ADR 0042 (S3 con Object Lock en una cuenta aparte, o almacenamiento del proveedor del servidor, cuyo soporte de bloqueo en modo de cumplimiento no se verificó).
5. ¿Quién crea cada mes la partición siguiente y quién recibe la alerta si falta? Hoy no hay observabilidad que lo haga.
6. ¿Se acepta que la ventana real en línea sea de 6 a 7 meses (se retira el mes completo)? ¿O se prefiere partición semanal, con más objetos y más trabajo operativo?
7. ¿Hay eventos de auditoría reales ya cargados en algún entorno que deban conservarse? Decide cuál de los tres caminos de migración aplica.
8. ¿Se acepta que `seq` deje de ser único a nivel de base de datos, apoyado solo en el lock y en la verificación?

### Qué no se verificó

- Ninguna de las migraciones propuestas se escribió ni se ejecutó; el comportamiento de PostgreSQL sobre RLS, disparadores y privilegios en particiones se tomó de su documentación y no de una prueba local.
- El costo de la consulta "último evento de la organización" sobre la tabla particionada y el efecto en la latencia del ADR 0023.
- El volumen real de eventos por mes (no hay cifra; se supuso bajo por el tamaño de la plataforma).
- Si el destino alternativo del archivo soporta Object Lock en modo de cumplimiento.
- La respuesta del área legal.
