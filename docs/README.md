# Documentación

Índice de la documentación del proyecto. La fuente de verdad es [`../plan.md`](../plan.md); estos documentos la desarrollan por área. Si una guía contradice al plan en seguridad, manda el plan.

## Por dónde empezar

| Si quieres... | Lee |
| --- | --- |
| Entender qué se construye y por qué | [`../plan.md`](../plan.md) |
| Ver cómo encajan las piezas | [`architecture.md`](architecture.md) |
| Saber por qué se decidió algo | [`adr/`](adr/README.md) |
| Escribir o revisar código del backend | [`backend.md`](backend.md) |
| Escribir o revisar código de la web | [`frontend.md`](frontend.md) |
| Entender las tablas, RLS y migraciones | [`database.md`](database.md) |
| Evaluar riesgos de seguridad | [`threat-model.md`](threat-model.md) |
| Operar el sistema o responder a un incidente | [`runbooks/`](runbooks/README.md) |
| Seguir el avance de una funcionalidad | [`../odd/tasks/`](../odd/tasks/phase-0-foundations.md) |
| Instalar y ejecutar el proyecto | [`../README.md`](../README.md) |

## Catálogo

| Documento | Tipo | Contenido |
| --- | --- | --- |
| [`../plan.md`](../plan.md) | Explicación y referencia | Plan técnico: ADR, arquitectura, jerarquía, autorización, cifrado, 2FA, gobernanza, infraestructura, riesgos, decisiones pendientes |
| [`backend.md`](backend.md) | Referencia y guía | Reglas de arquitectura, código, seguridad y pruebas de `apps/api` |
| [`frontend.md`](frontend.md) | Referencia y guía | Sistema de diseño, componentes, `DataTable`, i18n, seguridad en el navegador |
| [`database.md`](database.md) | Referencia | Diseño de la base de datos y RLS ("cómo quedará al final") |
| [`architecture.md`](architecture.md) | Explicación | Monolito modular, procesos, módulos, capas, multitenancy, estructura del repositorio y flujo de un caso de uso sensible |
| [`adr/`](adr/README.md) | Explicación | ADR 0001 a 0020 (aceptadas) y 0021 a 0024 (propuestas) |
| [`threat-model.md`](threat-model.md) | Referencia | STRIDE por módulo; borrador de la fase 0, revisado en cada fase |
| [`runbooks/`](runbooks/README.md) | How-to | Rotar DEK, restaurar respaldo, fuga de base de datos, usuario o servidor comprometido, transferir Raíz; borradores pendientes de ensayo |
| [`../odd/tasks/`](../odd/tasks/phase-0-foundations.md) | Seguimiento | Especificaciones numeradas (`S#`), tareas y bitácora por funcionalidad |
| [`../CLAUDE.md`](../CLAUDE.md) | Referencia | Reglas no negociables para el desarrollo con agentes |

## Mantenimiento

- Cada decisión de arquitectura nueva se registra como ADR (ver [`adr/README.md`](adr/README.md)).
- Los documentos se versionan en el mismo commit que el código que describen.
- Terminología fija: Raíz, Administrador, Líder, Operador (actores); KEK y DEK (claves); USE, VIEW, EDIT y MANAGE (niveles de compartición).
- Sugerido para CI: `markdownlint` y un verificador de enlaces sobre `docs/` y los `README.md` (aún no configurados).
