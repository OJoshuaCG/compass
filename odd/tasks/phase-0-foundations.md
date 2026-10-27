# Fase 0 · Fundaciones

Objetivo: monorepo funcional con backend (NestJS), frontend (React), diseño de base de datos, ADR y documentación. Rama: `main` (repo nuevo, trunk-based). Entrega: commits convencionales por parte terminada. Runner de pruebas: Vitest (`pnpm test`, vía Turborepo). Método de iteración (Ralph): hasta 5 iteraciones por tarea grande (implementar → ejecutar lint/tipos/pruebas → corregir).

## Specs

- S1. Monorepo pnpm + Turborepo (`apps/api`, `apps/web`, `packages/*`, `db`), ESM, TypeScript `strict` con las banderas de `docs/backend.md` §9.
- S2. Backend NestJS (Fastify) con arquitectura hexagonal por módulo (`docs/backend.md`): `shared/kernel`, módulo `crypto` (SecretCipher AES-256-GCM, AAD `org_id | credential_id | field | version`, caché de DEK con TTL 10 min y 10 000 usos, single-flight, adaptador local que se niega a arrancar en producción), módulo `audit` (cadena de hashes), contexto de organización (`RequestContext`, `UnitOfWork` con `SET LOCAL app.org_id`).
- S3. Frontend React + TypeScript + Tailwind v4 con tokens globales oscuros "carbón", i18n `es-MX`/`en-US`, fuentes Inter / Space Grotesk / JetBrains Mono, componentes reutilizables y una única `DataTable` (`docs/frontend.md`).
- S4. Diseño de base de datos documentado (`docs/database.md`, "cómo quedará al final") y migraciones SQL versionadas con RLS por tabla (`plan.md`, "Modelo de dominio y de datos").
- S5. ADR 001 a 020 escritos, más `docs/architecture.md`, `docs/threat-model.md`, `docs/runbooks/` y `README.md`.
- S6. Pruebas generadas y ejecutadas: dominio, criptografía (vectores y negativas), auditoría, RLS/aislamiento de tenants (PostgreSQL real vía Testcontainers + Podman), contraste de tokens, paridad i18n, `DataTable`.
- S7. CI (GitHub Actions) con lint, tipos y pruebas.
- S8. Criterio de salida de la fase 0 (plan): CI en verde; crypto, auditoría y contexto de organización con pruebas; RLS activo; esqueleto de UI con tokens oscuros e i18n; ADR 001 a 020 escritos.

## Tasks

| ID | Specs | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 Monorepo y configuración | S1 | inline | hecho (build, tipos, lint) | ver `git log` |
| T2 Base de datos (diseño + migraciones + pruebas) | S4, S6 | delegado (database-architect) | hecho: 55 pruebas, 3 iteraciones | ver `git log` |
| T3 Frontend (tokens, i18n, ui, DataTable, app) | S3, S6 | delegado (frontend-developer) | hecho: 120 pruebas, build 156 KB gzip, 1 iteración | ver `git log` |
| T4 Documentación (ADR, arquitectura, amenazas, runbooks, README) | S5 | delegado (documentation-expert) | hecho: ADR 0001–0024, enlaces verificados | ver `git log` |
| T5 Backend (kernel, crypto, audit, contexto, UnitOfWork) | S2, S6 | inline | hecho: 122 pruebas (unit + integración con PostgreSQL), 3 mutantes + 3 de integración detectados | ver `git log` |
| T6 CI | S7 | inline | hecho (`.github/workflows/ci.yml`, acciones por SHA); no ejecutado en GitHub | ver `git log` |
| T7 Revisión independiente y correcciones | S2, S6 | delegado (jd-judge-a/b, Judgment Day) | hecho: JUDGMENT APPROVED, ronda 1 | ver `git log` |

Route declaration: T2, T3 y T4 son tres unidades independientes con superficies disjuntas, de varios minutos cada una, lanzadas juntas (Writer trigger, motivo a: paralelismo). T5 y T6 quedan inline.

## Log

- L1 (2026-10-26, usuario, verbatim): "Puedes proceder con la elaboracion del plan? Tienes permiso de instalar dependencias, instalar nestjs para comenzar y react, si lo crees coherente, un monorepo, adelante, o si prefieres un repo para cada parte (backend y frontend) de acuerdo, aunque nos gustaria mas un monorepo. Documenta todo lo necesario, hay un agente especial para eso. Puedes comenzar tambien con el disenio de la base de datos, documentar como quedara al final, utiliza el metodo ralph para cada fase, hasta un maximo de 5 iteraciones por cada tarea grande, esto para validar ejecutando test, y probando que todo este correcto, ademas de checar que el codigo cumple su finalidad. Apoyate mucho de los agentes existentes, genera y ejecuta los test necesarios, corrige, documenta, y por cada parte finalizada, apoyate con el agente git para los conventional commits. Puedes utilizar el metodo sdd si lo ves disponible para la elaboracion de todo el codigo y planeacion. sigue buenas practicas y haz lo mejor posible, estas en modo auomatico por lo que tienes permiso de todo, te concedo el permiso."
- L2 (2026-10-26): SDD no está disponible como skill en este entorno; se usa ODD (este documento) como método de especificación.
- L3 (2026-10-26): Hallazgo de versiones: `typescript-eslint` 8.72 admite TypeScript `<6.1.0`; se fija TypeScript 6.0.3 (TS 7 romperia el lint). NestJS 12 es solo ESM, por lo que todo el repo es ESM (`module: nodenext`). Versiones con más de 7 días (`minimumReleaseAge` en pnpm).
- L4 (2026-10-26): Entorno sin Docker; Podman con socket de usuario activo (`/run/user/1000/podman/podman.sock`). Imágenes `postgres:17-alpine` y `redis:7-alpine` descargadas. Pruebas de integración: `DOCKER_HOST=unix:///run/user/1000/podman/podman.sock TESTCONTAINERS_RYUK_DISABLED=true`.
- L5 (2026-10-27): Los revisores `review-*` devolvieron `inspection: incomplete` (exigen el contexto inyectado por `gentle-ai review` y un repo git); no revisaron nada. Se usó Judgment Day (jd-judge-a y jd-judge-b, ciegos y en paralelo) sobre 82 archivos (sha256 bfc30638…6488).
- L6 (2026-10-27): Hallazgo confirmado por ambos jueces: `DataKeyResolver` cacheaba la versión activa y la DEK creadas en la transacción del llamador; un rollback dejaba cachés apuntando a una DEK inexistente. Corrección: creación y rotación en transacción independiente (`UnitOfWork.runIndependent`) sobre un pool propio. Mi primera versión usaba el mismo pool y producía un deadlock por inanición (la prueba de carrera se colgó); se corrigió con `independentPool`. Más: `reasonCode` obligatorio en negaciones, título correcto para 4xx, creación exclusiva (`wx`) de la KEK local. Re-juicio acotado: ambos jueces sin hallazgos.
- L7 (2026-10-27): Decisión de diseño adoptada del agente de BD: la cadena de auditoría (seq, prev_hash, hash, created_at) la calcula un trigger con advisory lock por organización; el módulo `audit` de TypeScript no calcula hashes. Hallazgo registrado: el índice ciego derivado de la DEK obliga a recalcular en cada rotación (docs/backend.md §16).
