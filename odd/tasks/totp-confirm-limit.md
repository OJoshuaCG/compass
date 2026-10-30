# Límite de intentos al confirmar el segundo factor (T5, B4; T5b: bloqueo escalonado)

Tarea tomada por la IA con permiso delegado del dueño. Ruta protegida (revelación e identidad): las pruebas de bloqueo y autorización necesitan revisión humana.

## Especificación (textual del encargo)

- "Lo único que falta de B4 es un límite de intentos al CONFIRMAR el registro de un segundo factor TOTP pendiente de la bóveda: límite por registro pendiente, con auditoría."
- Si la especificación fija número y consecuencia, se aplica tal cual; si no, se imita el mecanismo de contadores existente (en memoria hasta que haya Redis, una sola instancia).
- Consecuencia conservadora: tras N fallos consecutivos la confirmación de ese registro se bloquea (error de dominio con código estable) y hay que empezar un registro nuevo. La negación y el bloqueo se auditan.

Lectura de la especificación: `TODO.md` (N1), `docs/handoff.md` y `odd/tasks/phase-1b-vault.md` solo dicen que falta el límite y que hoy se audita cada fallo; **no fijan número ni consecuencia**. Se aplicó, por tanto, el mecanismo existente.

## Decisiones (por confirmar con el dueño)

| Decisión | Elegido | Motivo |
| --- | --- | --- |
| Número de fallos | 10 (`TOTP_CONFIRM_MAX_FAILURES`, `@iam/contracts`) | Igual al umbral de bloqueo del segundo factor de identidad |
| Consecuencia | ~~Bloqueo permanente hasta registrar de nuevo~~ (T5) reemplazado en T5b por bloqueo POR TIEMPO escalonado: 1ª vez 5 min, 2ª 15 min, 3ª y siguientes 60 min (`TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL`) | Decisión del dueño: un bloqueo permanente deja a cualquiera dejar inservible el registro de otra persona. Un re-registro sube `secretVersion` y reinicia todo |
| Contador y escalamiento | En memoria (`InMemoryTotpConfirmAttemptStore`, estado: fallos, nivel y fin del bloqueo), llave `credencial:versión`; la política es pura en `vault/domain/totp-confirm-lock.ts` y usa el `Clock` inyectado | Imita `InMemoryLoginAttemptStore`. Se descartó contar desde la auditoría: `created_at` es del reloj de la base y `registeredAt` del de la aplicación, y mezclarlos subcuenta con desfase |
| Código de error | `CREDENTIAL.TOTP_CONFIRM_LOCKED`, 429 | Vecinos `CREDENTIAL.TOTP_*`; 423 no se usa en ningún lado, `TOTP_CODE_LIMIT` ya es 429 |
| Orden de las comprobaciones | Tras bloqueo de fila, nivel EDIT y estado `pending`; antes de comparar el código | Un registro bloqueado no sirve de oráculo; el correcto tampoco confirma mientras dure el bloqueo. Un intento rechazado por bloqueo no cuenta como fallo |
| Reglas del escalonado (T5b) | Los fallos se cuentan por registro; al llegar a 10 se bloquea y el contador vuelve a 0; el nivel se conserva al expirar y solo lo limpia un acierto o un re-registro; el acierto durante el bloqueo no existe (no se compara) | Decisión del dueño |
| `Retry-After` / `retryAfterSeconds` (T5b) | NO se añadió | El filtro de Problem Details solo emite `Retry-After` para `RATE_LIMITED` y `CREDENTIAL.TOTP_CODE_LIMIT` no lo lleva: no hay patrón para este código y se pidió no inventarlo. Si se quiere, es un cambio chico al filtro (extenderlo a este código con `meta.retryAfterSeconds`) |
| Auditoría | Fallos: `credential.totp_confirmed` failure (ya existía). Bloqueo: `authz.denied` vía `authorizer.auditDenial` | Sin cambios a la lista blanca ni migración |

Limitaciones: la cuenta es por registro, no por persona; se pierde al reiniciar la API; con varias instancias cada una cuenta aparte (se resuelve con Redis).

## Tareas

| ID | Tarea | Estado |
| --- | --- | --- |
| T5-1 | Constante, código de error, mapeo HTTP y textos es-MX y en-US | Hecha |
| T5-2 | Puerto y almacén en memoria; cableado en el contenedor | Hecha |
| T5-3 | Comprobación en `ManageTotp.confirm` | Hecha |
| T5-4 | Pruebas unitarias (`manage-totp.confirm-limit.test.ts`, almacén) y e2e (`vault-totp.e2e.test.ts`) | Escritas, sin ejecutar |
| T5-5 | Documentación (`docs/business/two-factor.md`, `docs/backend.md`) | Hecha |
| T5b-1 | Política escalonada pura (`totp-confirm-lock.ts`), puerto y almacén con estado, `ManageTotp.confirm` con `Clock`, constantes en contratos, textos es-MX/en-US, docs | Hecha |
| T5b-2 | Pruebas: unitarias del caso de uso (escalonado, reloj, acierto, re-registro), de la política y del almacén; e2e con reloj avanzado | Escritas, sin ejecutar |
| T5b-3 | Desbloqueo anticipado por un superior (`unlockConfirmation`, `POST /credentials/:id/totp/unlock`, `credential.totp_unlocked`, botón en el diálogo web) | Hecha, pruebas escritas sin ejecutar |
| T5-6 | Revisión humana de las pruebas de bloqueo (marcadas `SENSIBLE`) y confirmación del número | Pendiente |

## Bitácora

- 2026-10-29: implementado. Verificado: `format:check`, `typecheck` y `lint` de `@iam/api`, `@iam/contracts` e `@iam/i18n`. NO ejecutadas las pruebas (las corre otro agente). Sin migración, sin dependencias nuevas. Sin cambios en la pantalla: el error nuevo se muestra con el texto genérico de `errors`.
- 2026-10-30 (T5b): el bloqueo permanente pasa a bloqueo por tiempo escalonado (5, 15, 60 minutos) por decisión del dueño. Textos de `CREDENTIAL.TOTP_CONFIRM_LOCKED` reescritos (es-MX y en-US, mismas claves) porque decían "registra de nuevo"; la pantalla no cambia (usa el texto genérico de `errors`). Sin migración, sin dependencias, sin cambios a la lista blanca de auditoría. Pruebas ajustadas y su porqué:
  - `manage-totp.confirm-limit.test.ts`: las pruebas existentes de T5 se conservan sin cambios de aserciones (siguen siendo ciertas: 10 fallos y el 11.º bloquea, el correcto no confirma bloqueado, re-registro reinicia). Solo cambió el armado: el reloj ahora es mutable para poder avanzarlo y se añadió `correctCodeNow` porque el código correcto depende del reloj. Se añadió la suite "escalating time lock" (5→15→60→60 con el límite exacto, recuento de 10 al expirar, correcto durante el bloqueo no confirma, insistir bloqueado no escala, acierto limpia, re-registro reinicia nivel, misma respuesta en cualquier nivel).
  - `in-memory-totp-confirm-attempt-store.test.ts`: reescrita porque el puerto cambió de `failures/recordFailure/clear` a `state/save/clear`; conserva la intención (aislamiento por llave y limpieza) y añade que `clear` olvida también nivel y bloqueo.
  - `totp-confirm-lock.test.ts` (nueva): duraciones, umbral, fin exacto del bloqueo y escalamiento.
  - `vault-totp.e2e.test.ts`: la prueba de bloqueo existente queda igual (el re-registro sigue desbloqueando); se añadió una que avanza el reloj de la prueba, libera por tiempo y comprueba que el 2.º bloqueo dura más.
  - NO ejecutadas (las corre otro agente). Limitación nueva: al descartar llaves por el tope de 10 000 registros se libera un bloqueo vigente; mismo riesgo que ya existía con los contadores, aceptado hasta Redis.
- 2026-10-30 (T5b-3, ruta protegida delegada por el dueño; revisión humana pendiente de lo marcado `SENSIBLE`): desbloqueo anticipado por un superior, sin enlace por correo. Decisiones y su porqué:
  - Permiso: se reutiliza `credential.export_totp` (administrar el segundo factor; es el que ya usa exportar y trae la reautenticación de 5 minutos del motor). Sin permiso nuevo ni migración. Consecuencia: el techo de rango 2 de ese permiso aplica, y quien es solo responsable de rango 3 no puede desbloquear aunque tenga MANAGE. No se exige motivo escrito (no se pidió, aunque ese permiso lo marca en el catálogo).
  - Nivel MANAGE sobre la cuenta (`AUTHZ.SHARE` auditado; sin acceso, `NOT_FOUND`).
  - Otra persona: si `actorId` es `registeredBy` del registro pendiente, `403 CREDENTIAL.TOTP_UNLOCK_SELF` con negación auditada. Si no está pendiente o bloqueado: `409 CREDENTIAL.TOTP_NOT_LOCKED` (un factor verificado o retirado también cuenta como "no bloqueado"). Esta comprobación va antes que la de la misma persona: no se audita como negación por autoría algo que ni siquiera estaba bloqueado.
  - Conserva el escalón: `afterUnlock` (dominio) deja fallos en cero y sin fin de bloqueo y mantiene `lockCount`. No hizo falta ampliar el puerto: se usa `save`.
  - Auditoría: acción nueva `credential.totp_unlocked` con metadatos `lockLevel` y `registeredBy` (lista blanca de auditoría, ruta protegida). Se escribe antes de tocar la memoria para que, si falla, la transacción se revierta y el bloqueo siga vigente.
  - Estado: `GET /credentials/:id/totp` expone `confirmLockedUntil` (opcional, nulo si no hay bloqueo vigente). Cambio de contrato aditivo.
  - Web: se añadió el botón "Desbloquear confirmación" con diálogo de confirmación en el diálogo del segundo factor (visible con la capacidad de exportar y el estado pendiente y bloqueado), textos es-MX y en-US con las mismas claves. Sin pruebas web nuevas.
  - Matriz de autorización: se añadió `POST /credentials/:id/totp/unlock` al manifiesto de `authorization-matrix.e2e.test.ts`.
  - Pruebas: `manage-totp.unlock.test.ts`, `totp-confirm-lock.test.ts` (`afterUnlock`) y e2e en `vault-totp.e2e.test.ts` dentro de `confirmation timed lock` (avanza el reloj; el describe de logs que sigue no avanza el reloj).
  - Verificado: `format:check`, `typecheck` y `lint`. NO ejecutadas las pruebas.
