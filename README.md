# Plataforma interna de identidad, accesos y bóveda

Sistema interno, de una sola organización, para gestionar personas, permisos y una bóveda compartida de credenciales y 2FA de plataformas (por ejemplo, redes sociales), con auditoría a prueba de manipulación. Está pensado para un equipo de tres personas y guarda secretos reales: la seguridad pesa más que la velocidad.

El diseño completo está en [`plan.md`](plan.md), que es la fuente de verdad. Si algo de otro documento contradice al plan en seguridad, manda el plan.

## Estado

**Fase 0 · Fundaciones** (en curso). Entrega: monorepo funcional, backend NestJS con `crypto`, `audit` y contexto de organización, frontend React con tokens oscuros e i18n, diseño de base de datos con migraciones y RLS, CI y documentación (ADR 0001 a 0020). Los módulos de negocio de la fase 1 (identidad, bóveda con 2FA, gobernanza) aún no existen. El seguimiento está en [`odd/tasks/phase-0-foundations.md`](odd/tasks/phase-0-foundations.md) y la hoja de ruta por fases en `plan.md` ("Alcance y hoja de ruta por fases").

## Requisitos

| Herramienta | Versión | Para qué |
| --- | --- | --- |
| Node.js | >= 24 (campo `engines` de `package.json`) | Runtime y herramientas |
| pnpm | 10 (`packageManager`: `pnpm@10.33.0`) | Gestor de paquetes del monorepo |
| Podman o Docker | Cualquiera con socket compatible | Pruebas de integración con PostgreSQL real (Testcontainers) |

Las dependencias se instalan con espera de 7 días tras cada publicación (`minimumReleaseAge`) y con scripts de instalación deshabilitados salvo lista blanca; ver `pnpm-workspace.yaml`. Agregar una dependencia requiere aprobación humana (ver [`CLAUDE.md`](CLAUDE.md)).

## Estructura del repositorio

```
/
├─ apps/
│  ├─ api/            # @iam/api: NestJS (Fastify)
│  └─ web/            # @iam/web: SPA React + Vite + Tailwind v4
├─ packages/
│  ├─ config/         # @iam/config: tsconfig base, ESLint base y reglas de límites
│  ├─ contracts/      # @iam/contracts: esquemas Zod, tipos, códigos de error
│  ├─ i18n/           # @iam/i18n: catálogos es-MX y en-US
│  └─ ui/             # @iam/ui: tokens de diseño y componentes
├─ db/                # @iam/db: migraciones SQL versionadas con RLS
├─ docs/              # guías, arquitectura, amenazas, ADR, runbooks
├─ odd/tasks/         # especificaciones y seguimiento por funcionalidad
├─ plan.md            # plan técnico (fuente de verdad)
└─ CLAUDE.md          # reglas no negociables para agentes
```

Detalle y diagramas en [`docs/architecture.md`](docs/architecture.md). `apps/mobile-handoff` (página de cámara para el 2FA por celular) está en el plan y aún no existe.

## Comandos

Todos se ejecutan desde la raíz y corren en cada workspace mediante Turborepo (`turbo run <tarea>`). Los scripts por workspace son los de cada `package.json`.

```bash
pnpm install          # instala dependencias del monorepo
pnpm build            # compila todos los workspaces que tienen build
pnpm lint             # ESLint en cada workspace
pnpm typecheck        # tsc --noEmit en cada workspace
pnpm test             # Vitest en cada workspace
pnpm format           # Prettier --write
pnpm format:check     # Prettier --check
```

Por workspace (ejemplos reales de los `scripts`):

```bash
pnpm --filter @iam/web dev        # servidor de desarrollo de la SPA (Vite)
pnpm --filter @iam/api test       # pruebas del backend
pnpm --filter @iam/db test        # pruebas de la base de datos (migraciones, RLS)
```

| Workspace | Scripts disponibles |
| --- | --- |
| raíz | `build`, `typecheck`, `lint`, `test`, `format`, `format:check` |
| `@iam/api` | `build`, `typecheck`, `lint`, `test` |
| `@iam/web` | `dev`, `build`, `typecheck`, `lint`, `test` |
| `@iam/db` | `build`, `typecheck`, `lint`, `test` |
| `@iam/contracts` | `build`, `typecheck`, `lint`, `test` |
| `@iam/i18n` | `typecheck`, `lint`, `test` |
| `@iam/ui` | `typecheck`, `lint`, `test` |

Tabla verificada contra los `package.json` del repositorio al redactar este README; si agregas o cambias scripts, actualízala.

### Pruebas de integración con Podman

Las pruebas de integración (RLS, aislamiento de tenants) levantan PostgreSQL real con Testcontainers. Con Docker funcionan sin configuración adicional. Con Podman, activa el socket de usuario y exporta estas variables antes de `pnpm test`:

```bash
systemctl --user enable --now podman.socket   # una sola vez, si el socket no está activo
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
export TESTCONTAINERS_RYUK_DISABLED=true
pnpm test
```

`TESTCONTAINERS_RYUK_DISABLED=true` desactiva el contenedor de limpieza (Ryuk), que no funciona con Podman sin privilegios. Las imágenes usadas son `postgres:17-alpine` y `redis:7-alpine`.

## Documentación

| Documento | Contenido |
| --- | --- |
| [`plan.md`](plan.md) | Plan técnico: decisiones, jerarquía, autorización, cifrado, fases, riesgos |
| [`docs/README.md`](docs/README.md) | Índice de toda la documentación |
| [`docs/backend.md`](docs/backend.md) | Guía de backend (arquitectura, código, pruebas) |
| [`docs/frontend.md`](docs/frontend.md) | Guía de frontend (diseño, componentes, i18n, `DataTable`) |
| [`docs/database.md`](docs/database.md) | Diseño de la base de datos |
| [`docs/architecture.md`](docs/architecture.md) | Arquitectura, módulos y flujos |
| [`docs/adr/`](docs/adr/README.md) | Registro de decisiones (ADR 0001 a 0024) |
| [`docs/threat-model.md`](docs/threat-model.md) | Modelo de amenazas (borrador de la fase 0) |
| [`docs/runbooks/`](docs/runbooks/README.md) | Runbooks de operación (borradores) |
| [`CLAUDE.md`](CLAUDE.md) | Reglas no negociables para el desarrollo con agentes |

## Convenciones

- Código, identificadores y nombres de archivo en inglés; comentarios y documentación en español.
- Conventional Commits, PR pequeños, trunk-based con ramas de vida corta.
- Toda PR requiere revisión humana; las que tocan rutas protegidas (`identity`, `access`, `crypto`, `audit`, migraciones con RLS, CSP y cabeceras) requieren dos revisores.
- Reglas de seguridad innegociables y definición de terminado: [`CLAUDE.md`](CLAUDE.md), `docs/backend.md` §15 y `docs/frontend.md` §15.

## Seguridad

No se registran ni se guardan secretos en el repositorio ni en logs. Los hallazgos de seguridad se reportan a las personas responsables del proyecto por un canal privado (canal por definir antes de producción).
