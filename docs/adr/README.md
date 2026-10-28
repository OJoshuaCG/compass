# Registro de decisiones de arquitectura (ADR)

Una decisión por archivo, numerada, con contexto, decisión, alternativas y consecuencias (regla de [`plan.md`](../../plan.md), sección "Comentarios y documentación"). Los ADR 0001 a 0020 son las decisiones cerradas de la tabla "Decisiones cerradas (ADR)" del plan y numeran igual que allí (001 a 020). Los ADR 0021 a 0024 nacieron como huecos detectados al analizar el plan (ver [`docs/backend.md`](../backend.md) §16). Con la fase 1a, el 0021 y el 0022 pasaron a **Aceptada (implementada en la fase 1a)**; el 0023 se aceptó el 2026-10-27 (su `lock_timeout` se implementó ese mismo día) y el 0024 sigue en **Propuesta** y no se implementa hasta aceptarse. Los ADR 0025 a 0030 se escribieron al implementar la fase 1a y nacen **Aceptada**.
Plantilla: [`template.md`](template.md).

## Decisiones cerradas

| ADR | Decisión | Estado |
| --- | --- | --- |
| [0001](0001-modular-monolith-hexagonal.md) | Monolito modular, hexagonal por módulo | Aceptada |
| [0002](0002-nestjs-typescript-monorepo.md) | NestJS + TypeScript de punta a punta, monorepo | Aceptada |
| [0003](0003-postgresql-single-source-of-truth.md) | PostgreSQL como única fuente de verdad | Aceptada |
| [0004](0004-server-side-encryption-kms-per-org-dek.md) | Cifrado del lado del servidor con KMS y DEK por organización | Aceptada |
| [0005](0005-in-memory-dek-cache.md) | Caché en memoria de DEK descifradas, TTL 10 min | Aceptada |
| [0006](0006-multitenancy-ready-rls.md) | Multitenancy preparada: `organization_id` + RLS en todas las tablas | Aceptada |
| [0007](0007-four-actors.md) | 4 actores: Raíz, Administrador, Líder, Operador | Aceptada |
| [0008](0008-authority-rank-and-subtree.md) | Autoridad = rango estrictamente inferior + subárbol de gestión | Aceptada |
| [0009](0009-created-by-vs-managed-by.md) | `created_by` inmutable separado de `managed_by` transferible | Aceptada |
| [0010](0010-managing-people-grants-no-secret-access.md) | Gestionar personas no da acceso a secretos | Aceptada |
| [0011](0011-three-axis-authorization.md) | Autorización en tres ejes: jerarquía, permisos (RBAC), alcance (ACL) | Aceptada |
| [0012](0012-no-permission-escalation.md) | Nadie otorga un permiso que no tiene | Aceptada |
| [0013](0013-server-side-totp-generation.md) | Códigos TOTP generados en el servidor; el secreto no sale | Aceptada |
| [0014](0014-server-sessions-with-cookie.md) | Sesiones de servidor con cookie, no JWT, para la propia app | Aceptada |
| [0015](0015-mandatory-mfa-passkeys-preferred.md) | MFA obligatorio; passkeys como método preferido | Aceptada |
| [0016](0016-append-only-audit-hash-chain.md) | Auditoría append-only con encadenamiento de hashes | Aceptada |
| [0017](0017-five-totp-enrollment-methods.md) | Cinco métodos de registro de 2FA, todos disponibles | Aceptada |
| [0018](0018-sso-provider-oidc-provider-and-samlify.md) | Proveedor SSO con `oidc-provider` (fase 2) y SAML (fase 3) | Aceptada |
| [0019](0019-cerby-style-broker-ports-first.md) | Broker tipo Cerby: puertos e interfaces desde la fase 1, implementación al final | Aceptada |
| [0020](0020-reference-cloud-aws.md) | Nube de referencia AWS, adaptadores intercambiables | Aceptada con confirmación pendiente |

## Decisiones surgidas del análisis del plan y de la fase 1a

| ADR | Decisión | Estado |
| --- | --- | --- |
| [0021](0021-pre-authentication-access-with-rls.md) | Acceso previo a la autenticación con RLS (funciones de lectura mínimas) | Aceptada (implementada en la fase 1a) |
| [0022](0022-audit-of-denials-in-independent-transaction.md) | Auditoría de negaciones en transacción independiente | Aceptada (implementada en la fase 1a) |
| [0025](0025-session-time-single-clock-source.md) | Aislamiento del tiempo de las sesiones: una sola fuente de reloj | Aceptada |
| [0026](0026-atomic-failed-attempt-counting.md) | Intentos fallidos contados de forma atómica | Aceptada |
| [0027](0027-emergency-codes-root-reset-model.md) | Códigos de emergencia: solo los custodios restablecen a la Raíz | Aceptada |
| [0028](0028-passkeys-optional-enforcement-later.md) | Passkeys opcionales para todos; exigirlas queda como configuración futura (resuelve la política pendiente del 0015 sin reemplazarlo) | Aceptada |
| [0029](0029-idempotency-reservation-and-ownership.md) | Idempotencia con reserva y propiedad de la clave | Aceptada |
| [0030](0030-session-bound-webauthn-challenges.md) | Desafíos de WebAuthn ligados a la sesión | Aceptada |
| [0031](0031-reveal-rate-limit-per-user.md) | Límite de revelaciones por usuario | Aceptada (implementación pendiente) |
| [0032](0032-blind-index-derived-from-dek.md) | Índice ciego derivado de la clave de datos | Aceptada |
| [0033](0033-reauthentication-totp-and-passkey.md) | Reautenticación con TOTP o passkey (amplía el 0028) | Aceptada (implementada; falta la prueba de navegador) |
| [0034](0034-totp-generator-in-api-process.md) | Generador de TOTP en el proceso de la API, aislado antes de producción | Aceptada (aislamiento pendiente, N4) |
| [0035](0035-transactional-outbox-for-events.md) | Eventos mediante bandeja de salida transaccional | Aceptada (implementación pendiente) |
| [0036](0036-effective-access-computed-on-the-fly.md) | Acceso efectivo calculado al vuelo | Aceptada |

## Propuestas (huecos detectados, sin decidir)

| ADR | Tema | Estado | Se necesita antes de |
| --- | --- | --- | --- |
| [0023](0023-audit-advisory-lock-and-long-transactions.md) | Advisory lock de auditoría y transacciones largas | Aceptada (2026-10-27; `lock_timeout` implementado, medición p95 pendiente) | Fase 1b (primeras acciones sensibles concurrentes) |
| [0024](0024-audit-retention-vs-revoke-delete.md) | Retención de auditoría frente a `REVOKE DELETE` | Propuesta | Fase 1c (auditoría con retención) |

Las fases indicadas son una recomendación de este registro, no una decisión del plan.

## ADR futuro ya anunciado en el plan

La tabla `identities` separada de `memberships` (una persona en varias organizaciones) queda registrada como ADR futuro en la sección "Identidad y organizaciones" del plan; no se redacta hasta que se necesite.

## Cómo añadir un ADR

1. Copia [`template.md`](template.md) a `NNNN-slug.md` con el siguiente número libre (slug en inglés, como el resto de nombres de archivo del repositorio).
2. Escribe el estado, la fecha y las secciones. Marca las alternativas inferidas.
3. Añade la fila al índice de este archivo.
4. Si reemplaza a otro, cambia el estado del anterior a "Reemplazada por ADR NNNN" sin reescribir su contenido.
