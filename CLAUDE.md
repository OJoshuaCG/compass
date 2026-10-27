# Plataforma interna de identidad, accesos y bóveda

Monorepo (pnpm + Turborepo): `apps/api` (NestJS), `apps/web` (React), `apps/mobile-handoff`, `packages/*`, `db/migrations`, `docs/`. El producto guarda secretos reales: la seguridad pesa más que la velocidad.

## Documentos de referencia (léelos antes de escribir)

| Documento | Cuándo |
| --- | --- |
| `plan.md` | Fuente de verdad: ADR, jerarquía, autorización, cripto, fases. Si algo contradice al plan en seguridad, manda el plan |
| `docs/backend.md` | Cualquier cambio en `apps/api`, `db/` o `packages/contracts` |
| `docs/frontend.md` | Cualquier cambio en `apps/web`, `apps/mobile-handoff` o `packages/ui`/`i18n` |
| `docs/handoff.md` | Estado actual, plan de continuación ordenado, decisiones abiertas y trampas de entorno. Léelo al retomar el trabajo |
| `docs/business/` | Lógica de negocio (sin código): actores, permisos, bóveda, 2FA, autenticación, gobernanza y estado por fase. Léelo antes de tocar reglas |
| `docs/database.md` | Cambios en `db/`, tablas, RLS, roles o auditoría |
| `docs/architecture.md`, `docs/threat-model.md`, `docs/adr/`, `docs/runbooks/` | Visión global, amenazas, decisiones (ADR 0001–0024) y procedimientos (borradores) |
| `odd/tasks/` | Seguimiento de cada funcionalidad grande (especificaciones, tareas, bitácora) |

Si una regla no está cubierta por estos documentos, propónla y detente. No improvises.

## Reglas no negociables

- Arquitectura hexagonal en backend: respeta las capas y la regla de dependencia de `docs/backend.md`. Entre módulos, solo por `index.ts` o eventos (outbox).
- Toda consulta pasa por repositorios con contexto de organización. Nunca SQL sin RLS.
- Todo caso de uso que toca usuarios o bóveda llama a `Authorizer.authorize()`. El guard del controlador no es la autorización.
- Toda acción sensible escribe auditoría en la misma transacción.
- Criptografía solo vía `modules/crypto` (`SecretCipher`). Prohibido importar `node:crypto` fuera.
- Nunca registres secretos, tokens, cookies ni cuerpos de peticiones de rutas sensibles.
- Los secretos solo viven en el estado local del componente que los muestra; nunca en TanStack Query, contexto ni almacenamiento del navegador.
- Frontend: usa siempre componentes de `shared/ui`; toda tabla es `DataTable`; solo tokens de estilo, sin colores ni tamaños literales; ningún texto literal (i18n `es-MX` y `en-US`).
- Prohibido `any`, `dangerouslySetInnerHTML`, `innerHTML` y `eval`.
- No agregues dependencias. Si crees que hace falta una, propónla con su justificación y detente.
- No edites migraciones ya aplicadas; crea una nueva. Toda tabla nueva lleva `organization_id`, índice y política RLS en la misma migración.
- Nunca leas `.env*`, secretos ni datos de producción. No ejecutes comandos de red ni de despliegue.

## Rutas protegidas

`modules/identity`, `modules/access`, `modules/crypto`, `modules/audit`, migraciones con RLS, `SecretReveal`, y la configuración de CSP y cabeceras.

- No las modifiques salvo encargo humano explícito. Sí puedes revisarlas.
- Todo cambio ahí se revisa línea por línea con dos personas; "las pruebas pasan" no basta.
- Las pruebas de la matriz de autorización, criptografía y aislamiento de tenants las escribe o las revisa una persona.

## Convenciones

- Código, identificadores y nombres de archivos en inglés; comentarios y documentación en español. Los comentarios explican **por qué**, no qué.
- Conventional Commits, PR pequeños, trunk-based con ramas cortas.
- Estilo y estructura: sigue el código vecino. Reutiliza antes de crear (`Result`, `DataTable`, `cn()`, `useTableQuery`, `Authorizer`, `AuditLog`, `UnitOfWork`).
- Comandos (desde la raíz): `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`. Las pruebas de integración necesitan Docker o Podman (`DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock TESTCONTAINERS_RYUK_DISABLED=true`).
- Stack fijo: Node >= 24, pnpm 10, TypeScript 6.0 (no 7, incompatible con `typescript-eslint`), todo ESM. Las dependencias se instalan con versión exacta y respetan `minimumReleaseAge` (7 días).

## Trabajo con agentes

- Frontend: `frontend-developer`, `typescript-pro`, `ui-ux-designer` (solo lectura). Backend: `general-purpose` para implementar con alcance acotado, `Explore`/`Plan` para mapear y diseñar, `review-risk`, `review-resilience`, `review-reliability` y `review-readability` para revisar. Detalle y límites en `docs/frontend.md` §16 y `docs/backend.md` §14.
- Todo encargo a un agente nombra el documento que debe leer, las rutas que puede editar y los criterios de aceptación. Los agentes no agregan dependencias ni tocan rutas protegidas.
- La revisión de código sensible la hace alguien distinto de quien lo escribió.

## Definición de terminado

- Lint, tipos y pruebas en verde.
- Backend: pruebas de dominio; integración con PostgreSQL real si toca repositorios; matriz de autorización si toca permisos; prueba de aislamiento si añade tablas o listados.
- Frontend: pruebas de componente y de accesibilidad; claves i18n en ambos idiomas; contraste de tokens y límites de arquitectura en verde.
- Las listas completas están en `docs/backend.md` §15 y `docs/frontend.md` §15.
