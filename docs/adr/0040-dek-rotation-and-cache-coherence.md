# ADR 0040: Rotación de la clave de datos, recifrado e índices ciegos

- **Estado**: Aceptada (2026-10-28) por el dueño (`TODO.md` F4)
- **Fecha**: 2026-10-28
- **Referencias**: [ADR 0004](0004-server-side-encryption-kms-per-org-dek.md); [ADR 0005](0005-in-memory-dek-cache.md); [ADR 0032](0032-blind-index-derived-from-dek.md); [ADR 0039](0039-single-instance-until-redis.md); [runbook de rotación](../runbooks/rotate-dek.md); `apps/api/src/modules/crypto/application/data-key-resolver.ts`; migraciones `0002`, `0005` y `0006`.

## Contexto

Verificado en el código a la fecha:

- `DataKeyResolver.rotate()` crea una versión nueva de la DEK y la deja activa, pero **ningún proceso la llama** (solo pruebas) y **no existe el trabajo de recifrado**: tras rotar, todo lo ya cifrado seguiría con la versión anterior para siempre.
- Las versiones de DEK son inmutables: una versión `(organización, n)` siempre produce la misma clave. Por eso la caché de DEK en claro (clave `organización:versión`) nunca queda desactualizada; solo puede quedar desactualizado el **puntero a la versión activa**, que se recuerda 60 s (`DEFAULT_ACTIVE_VERSION_TTL_MS`).
- Tres lugares guardan texto cifrado con su `dek_version`: `user_totp_factors`, `credential_secrets` (la bóveda aún no recibe datos reales) y la carga útil opcional de auditoría (`payload_dek_version`). Las dos primeras tienen una clave foránea a `data_keys (organization_id, version)`: **una versión no se puede borrar mientras algo la referencie**.
- El índice ciego y la huella de contraseña se derivan de la DEK con HKDF, así que cambian con ella (ADR 0032).
- Con la instancia única decidida en el ADR 0039 no hay otras cachés que invalidar.

Faltaba decidir quién dispara la rotación, cómo se recifra sin parar el servicio, qué pasa con las cachés y cuándo se destruye una versión retirada.

## Decisión

1. **Disparo.** La rotación es una acción explícita de un Administrador, con reautenticación y auditoría en la misma transacción, y también la ejecuta el trabajo programado trimestral. Una rotación por incidente exige además a la Raíz. Solo una rotación en curso por organización: la restricción única `(organización, versión)` ya lo impone y `rotate()` falla cerrado ante un conflicto.
2. **Recifrado.** Un trabajo de mantenimiento (mismo molde que la purga del ADR 0038: recorre organizaciones con `auth.list_organization_ids()` y fija el contexto de organización) procesa los textos cifrados de la versión vieja **por lotes**:
   - cada fila se abre con su versión y se vuelve a cifrar con la activa dentro de **una transacción por lote**, con comparación y escritura condicionada a que `dek_version` siga siendo la leída (si otra escritura la tocó, se omite y se reintenta en el siguiente pase);
   - es idempotente y reanudable: no necesita checkpoint propio, porque las filas pendientes son exactamente las que aún tienen la versión vieja;
   - recalcula en el mismo paso la huella y el índice ciego de cada secreto;
   - no escribe texto en claro en registros, métricas ni auditoría; la auditoría lleva conteos y la versión, nunca contenido.
3. **Búsqueda durante la convivencia.** Mientras existan filas con la versión vieja, la búsqueda por índice ciego consulta el valor derivado de **ambas** versiones (a lo sumo dos). Cuando el recifrado termina y se verifica que ninguna fila conserva la versión vieja, se vuelve a una sola consulta. Se mantiene la derivación desde la DEK del ADR 0032.
4. **Cachés.** No se invalida la caché de DEK en claro: las versiones son inmutables. Al rotar, el puntero a la versión activa del propio proceso se borra (ya lo hace `rotate()`). Si la rotación es **por incidente**, además se reinicia la API para descartar de memoria toda DEK en claro (`clearCache()` en el apagado ordenado), porque la DEK en memoria de un proceso comprometido debe darse por expuesta. Con más de una instancia (ADR 0039 exige una decisión nueva antes) el puntero tardaría hasta 60 s en converger, sin riesgo: la versión vieja sigue pudiendo descifrar.
5. **Retiro y destrucción.** La versión vieja pasa a `retired` al terminar el recifrado. No se destruye por tiempo: solo cuando (a) ninguna fila de ninguna tabla la referencia, (b) la verificación del runbook cerró y (c) la política de retención y de respaldos lo permite, porque los respaldos anteriores siguen necesitándola para abrirse. Esa política sigue pendiente (C9) y se decide con el área legal.
6. **Verificación mínima antes de producción.** Prueba con datos de ambas versiones conviviendo (descifrado, búsqueda por índice ciego y detección de contraseñas repetidas), prueba de interrupción y reanudación del recifrado, y un ensayo del runbook en staging.

## Alternativas consideradas

- **Rotar sin recifrar** (solo versión nueva para lo que se escriba después): descartada. Si la rotación es por incidente, lo ya cifrado seguiría protegido por la clave que se quería retirar.
- **Recifrado en una sola transacción por organización**: descartada. Bloquea escritores y crece con el volumen; el lote acota bloqueos y el estado pendiente se deduce de los datos.
- **Clave estable para el índice ciego**: ya evaluada y descartada por el ADR 0032; se reconsidera solo si el recálculo resulta ser el cuello de botella medido.
- **Invalidar cachés por difusión entre instancias**: descartada. Innecesaria con instancia única y con versiones inmutables.

## Consecuencias

- **Positivas**: una rotación completa y reanudable; ninguna ventana en la que una versión retirada quede sin poder abrirse; sin superficie criptográfica nueva fuera del módulo `crypto`.
- **Negativas o costos**: el recifrado toca todas las filas cifradas de la organización y durante la convivencia la búsqueda por índice ciego hace una consulta más; la destrucción de versiones viejas depende de una decisión de retención que no está tomada.
- **Pendiente si se acepta**: implementar el trabajo de recifrado y el disparo (rutas protegidas ⚠: encargo humano explícito y revisión adversarial con dos revisores ciegos; sus pruebas de criptografía y aislamiento las revisa una persona), cerrar los comandos "por definir" del runbook (L2) y ensayarlo (Q1, Q2).

## Enmienda de implementación (2026-10-28)

Al implementar (TODO F4a) se verificó el código y varias premisas del contexto no coinciden. La decisión no cambia; esto corrige los hechos y fija cómo se aplicó:

- **No hay índice ciego ni huella guardados todavía.** `SecretCipher.blindIndex()` existe, pero ninguna tabla lo persiste salvo la columna `credential_secrets.blind_index`, que ningún código escribe (la bóveda está vacía). El recálculo del punto 2 y la búsqueda sobre ambas versiones del punto 3 se implementan cuando exista el primer uso (K1/O1): el recifrador de `credential_secrets` los recalculará en el mismo paso.
- **Dónde está cada versión.** `payload_dek_version` pertenece a `totp_handoffs`, no a la auditoría, y solo `credential_secrets` tiene clave foránea a `data_keys`; `user_totp_factors` y `totp_handoffs` guardan el número sin esa garantía, por lo que la verificación de "nada referencia la versión vieja" debe contar filas en las tres tablas, no apoyarse en la clave foránea.
- **Retiro.** `rotate()` ya marca `retired` la versión anterior al activar la nueva, no al terminar el recifrado. No cambia la seguridad (una versión retirada sigue abriendo lo cifrado con ella); lo que se condiciona al fin del recifrado es la **destrucción**, que sigue pendiente de C9.
- **Permiso.** El disparo usa `platform.manage` (Administrador y Raíz, con reautenticación y auditoría crítica), no un permiso nuevo. La rotación por incidente exige además `org.settings` (solo la Raíz).
- **Auditoría y rotación.** `rotate()` confirma en su propia transacción. El caso de uso escribe la auditoría **antes** de rotar y en la misma transacción de la acción: si la auditoría falla, no se rota. Si la rotación falla después (otra en curso), la transacción se revierte y no queda un evento de éxito.
- **Recifrado implementado.** `user_totp_factors` (incluidos los factores revocados) mediante `SecretCipher.reseal`, un lote por transacción con bloqueo de fila y comparación y escritura condicionada a la versión leída; el trabajo es `pnpm --filter @iam/api reencrypt`. Termina con código 1 si queda algo en una versión anterior.
- **Pendiente.** Recifrado de `credential_secrets` (necesita una migración que amplíe el permiso de actualización de columnas) y de `totp_handoffs` (sin código aún); la rotación trimestral programada; el reinicio de la API en rotaciones por incidente.
