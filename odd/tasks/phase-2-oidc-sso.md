# Fase 2: Compass como proveedor OIDC (SSO)

- **Objetivo**: que Compass sea proveedor de inicio de sesión único por OIDC con `oidc-provider` 9.13.3, con una sola sesión raíz (ADR 0050 y ADR 0051).
- **Rama**: `main` (autorizado por el CLAUDE.md del proyecto). **Entrega**: commits por unidad, sin push.
- **Pruebas**: `pnpm --filter @iam/api test:unit` y `test:integration` (Podman); `pnpm e2e` si cambia la interfaz o la API HTTP.

## Specs

- **S1** (ADR 0050, spike 1): flujo Authorization Code con PKCE obligatorio, con login y consentimiento servidos por Compass y reutilizando su módulo de identidad, «sin crear una segunda sesión con vida propia».
- **S2** (spike 2): sin implicit ni password grant; `redirect_uri` con coincidencia exacta.
- **S3** (spike 3): rotación de _refresh token_ con detección de reuso: reusar uno ya rotado revoca toda la concesión.
- **S4** (spike 4): cierre de sesión iniciado por la aplicación y _back-channel logout_ hacia el cliente, enviado por el outbox con reintentos.
- **S5** (spike 5, ADR 0051 §3): al desactivar o suspender a una persona se revocan **todas** sus concesiones, haya o no sesión viva.
- **S6** (spike 6): cabeceras y CSP del proyecto intactas en las rutas del paquete; el adaptador a PostgreSQL respeta el aislamiento por organización (RLS).
- **S7** (spike 7): fijar el `ack` de las funciones experimentales que se usen, para que una actualización incompatible falle al arrancar.
- **S8** (ADR 0051 §1-2): la fila de `sessions` es la única raíz; cada concesión guarda la sesión de Compass de la que nace y se expone un `sid` opaco distinto del identificador interno.
- **S9** (ADR 0051 §3): cerrar, vencer o revocar una sesión de Compass revoca sus concesiones; la revocación en base de datos va en la misma transacción que la auditoría.
- **S10** (ADR 0051 §4, D2, D3): _access token_ de 5 minutos; _refresh token_ solo si el cliente lo justifica, rota en cada uso, comprueba que la sesión siga viva y no vive más que `expires_at` de la sesión.
- **S11** (ADR 0051 §5): `auth_time`, `acr` y `amr` salen de `mfa_at`; se respetan `prompt=login` y `max_age` forzando reautenticación real.
- **S12** (ADR 0051 D1): usar una aplicación cuenta como actividad de la sesión, con el tope absoluto de 12 horas.
- **S13** (ADR 0051 §7): las sesiones de dispositivo y del broker no emiten SSO.
- **S14** (ADR 0050 §SSRF, supuesto): los avisos back-channel hacia IP privadas o loopback quedan bloqueados por defecto; se permiten solo para clientes de una lista explícita.
- **S15** (CLAUDE.md): toda tabla nueva lleva organización, índice y política de aislamiento; migraciones nuevas, nunca editar las aplicadas; textos en es-MX y en-US; sin dependencias fuera de `oidc-provider` 9.13.3 (exacta) y las ya aprobadas.

## Tareas

| ID  | Specs        | Ruta      | Estado    | Commit |
| --- | ------------ | --------- | --------- | ------ |
| T0  | —            | inline    | hecho     | spike en ADR 0050, `aab87ee` |
| T1  | S14, S15     | inline    | hecho (ADR 0052, decisiones 1A-4A) | ver commit de esta unidad |
| T2  | S15          | inline    | hecho (`pnpm add` exacta, lockfile +31 paquetes) | ver commit de esta unidad |
| T3  | S6, S8, S15  | inline    | en pruebas (migración 0045) | — |
| T4  | S6, S7       | inline    | pendiente | — |
| T5  | S8, S9       | inline    | pendiente | — |
| T6  | S1-S3, S7, S10 | inline  | pendiente | — |
| T7  | S6           | inline    | pendiente | — |
| T8  | S1, S11, S13 | inline    | pendiente | — |
| T9  | S4, S5, S9, S12 | inline | pendiente | — |
| T10 | todas        | inline    | pendiente | — |
| T11 | todas        | jueces    | pendiente | — |

- **T1**: decisiones del dueño y ADR complementario (clientes, claves de firma, quién puede entrar, consentimiento).
- **T2**: añadir `oidc-provider@9.13.3` exacta a `apps/api` (sin excepción de la espera de 7 días: cumple desde 2026-11-05).
- **T3**: migración `0045` (plantilla `0036_saved_account_views.sql`): clientes, cargas del paquete con `grant_id`, `uid`, sesión de Compass y organización; funciones de lectura previas a la autenticación (patrón ADR 0021); pruebas de RLS en `db/tests/`.
- **T4**: puerto de claves de firma en `modules/crypto` (única capa con `node:crypto`), cifradas con `SecretCipher`; rotación.
- **T5**: módulo `federation` (domain/application): puerto `GrantRevoker`, registro de clientes, casos de uso.
- **T6**: adaptador a PostgreSQL y fábrica del proveedor (`jwks`, `ttl`, PKCE, `ack`, SSRF).
- **T7**: montaje sobre Fastify antes del comodín de `serve-web.ts`, `/.well-known`, cabeceras y CSP.
- **T8**: interacciones de login y consentimiento sobre `returnTo`; pantalla web nueva; i18n es-MX y en-US; validación a 375, 768, 1024 y 1440 px.
- **T9**: enganche en `manage-users.ts`, `logout.ts` y `change-password.ts`; auditoría en la misma transacción; manejador del outbox para el aviso.
- **T10**: pruebas de la lista «Verificación» del ADR 0051, prueba de rotura deliberada, documentación (`docs/backend.md`, `docs/database.md`, `docs/business/authentication.md`), variables en `config.ts` y `.env.example`.
- **T11**: revisión adversarial con `jd-judge-a` y `jd-judge-b` sobre el alcance congelado (código sensible).

## Log

- **L1** (2026-11-18, la persona dueña): «Adelante con lo necesario, sin problema puedes llevar a cabo todas las tareas necesarias y planeadas. SI tienes alguna pregunta, hazla de una vez».
- **L2** (2026-11-18): spike repetido con `oidc-provider` 9.13.3: criterios 1-5 y 6a OK, igual que con 9.15.0. Mapa de la API hecho por un explorador de solo lectura (módulos, sesiones, outbox, migraciones, CSP, crypto, web).
- **L3** (2026-11-18): se detienen las tareas que tocan diseño hasta que la persona dueña responda las preguntas de clientes, claves de firma, acceso por cliente y consentimiento.
- **L4** (2026-11-18, la persona dueña): «Sin problema puedes proceder con las decisiones recomendadas». Quedan fijadas 1A (solo la Raíz registra clientes, por API), 2A (emisor único, claves de firma en `oidc_signing_keys` sin organización), 3A (personas activas de la organización del cliente, `max_rank` opcional) y 4A (consentimiento solo para clientes `is_external`). Ver ADR 0052. Se levanta el bloqueo de L3.
- **L5** (2026-11-18): `db/tests/auth-functions.test.ts` ya estaba desactualizado antes de 0045 (no listaba las 5 funciones del worker de correo entrante); se corrige con la lista real y se distingue qué rol ejecuta cada función.
