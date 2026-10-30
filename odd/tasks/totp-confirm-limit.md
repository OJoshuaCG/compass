# Límite de intentos al confirmar el segundo factor (T5, B4)

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
| Consecuencia | Bloqueo del registro pendiente hasta registrar de nuevo; sin expiración | Conservadora; un re-registro sube `secretVersion` y reinicia la cuenta |
| Contador | En memoria (`InMemoryTotpConfirmAttemptStore`), llave `credencial:versión` | Imita `InMemoryLoginAttemptStore`. Se descartó contar desde la auditoría: `created_at` es del reloj de la base y `registeredAt` del de la aplicación, y mezclarlos subcuenta con desfase |
| Código de error | `CREDENTIAL.TOTP_CONFIRM_LOCKED`, 429 | Vecinos `CREDENTIAL.TOTP_*`; 423 no se usa en ningún lado, `TOTP_CODE_LIMIT` ya es 429 |
| Orden de las comprobaciones | Tras bloqueo de fila, nivel EDIT y estado `pending`; antes de comparar el código | Un registro agotado no sirve de oráculo; el correcto tampoco confirma |
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
| T5-6 | Revisión humana de las pruebas de bloqueo (marcadas `SENSIBLE`) y confirmación del número | Pendiente |

## Bitácora

- 2026-10-29: implementado. Verificado: `format:check`, `typecheck` y `lint` de `@iam/api`, `@iam/contracts` e `@iam/i18n`. NO ejecutadas las pruebas (las corre otro agente). Sin migración, sin dependencias nuevas. Sin cambios en la pantalla: el error nuevo se muestra con el texto genérico de `errors`.
