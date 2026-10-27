# ADR 0002: NestJS + TypeScript de punta a punta, monorepo

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) secciones "Decisiones cerradas (ADR)" y "Stack tecnológico y bibliotecas aprobadas"; [`docs/backend.md`](../backend.md) §2 y §9; [`docs/frontend.md`](../frontend.md).

## Contexto

El equipo conoce TypeScript. API, web y la futura extensión de navegador necesitan compartir tipos y esquemas de validación para no redefinir contratos. Las dependencias se controlan con aprobación humana y versiones exactas.

## Decisión

NestJS (adaptador Fastify) y TypeScript en modo `strict` en backend, y React + TypeScript en frontend, dentro de un monorepo con pnpm workspaces y Turborepo. Los contratos viven en `packages/contracts` (esquemas Zod) y se comparten entre API y web.

## Alternativas consideradas

- **Un repositorio por parte (backend y frontend)** _(inferida del plan)_: descartada porque duplicaría contratos y tipos; el monorepo comparte esquemas.
- **Otros lenguajes o frameworks de servidor** _(inferida del plan)_: descartados por el conocimiento del equipo y por perder los tipos compartidos de punta a punta.

## Consecuencias

- **Positivas**: una sola definición por contrato (Zod); builds incrementales con Turborepo; mismo lenguaje en todo el equipo.
- **Negativas o costos**: el ecosistema ESM y las versiones de TypeScript condicionan el lint (la versión de TypeScript se fija según lo que admite `typescript-eslint`; ver [`odd/tasks/phase-0-foundations.md`](../../odd/tasks/phase-0-foundations.md), entrada L3).
- **Verificación**: `pnpm typecheck`, `pnpm lint` y `pnpm test` vía Turborepo en CI; `tsconfig` base en `packages/config`.
