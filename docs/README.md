# Documentación

Índice de la documentación del proyecto. La fuente de verdad es [`../plan.md`](../plan.md); estos documentos la desarrollan por área. Si una guía contradice al plan en seguridad, manda el plan.

## Por dónde empezar

| Si quieres... | Lee |
| --- | --- |
| **Retomar el proyecto en otro equipo** (estado, plan ordenado, decisiones abiertas, trampas) | [`handoff.md`](handoff.md) |
| Entender qué hace el sistema y por qué, sin tecnicismos | [`business/`](business/README.md) |
| Entender el plan técnico completo | [`../plan.md`](../plan.md) |
| Ver cómo encajan las piezas | [`architecture.md`](architecture.md) |
| Saber por qué se decidió algo | [`adr/`](adr/README.md) |
| Escribir o revisar código del backend | [`backend.md`](backend.md) |
| Escribir o revisar código de la web | [`frontend.md`](frontend.md) |
| Entender las tablas, RLS y migraciones | [`database.md`](database.md) |
| Evaluar riesgos de seguridad | [`threat-model.md`](threat-model.md) |
| Operar el sistema (alta de organizaciones, correo, una sola instancia) o responder a un incidente | [`runbooks/`](runbooks/README.md) |
| Seguir el avance de una funcionalidad | [`../odd/tasks/`](../odd/tasks/phase-0-foundations.md) |
| Instalar y ejecutar el proyecto | [`../README.md`](../README.md) |

## Catálogo

| Documento | Tipo | Contenido |
| --- | --- | --- |
| [`business/`](business/README.md) | Explicación y referencia | Lógica de negocio sin código: actores, permisos, bóveda, 2FA, autenticación, gobernanza y hoja de ruta, con glosario |
| [`../plan.md`](../plan.md) | Explicación y referencia | Plan técnico: ADR, arquitectura, jerarquía, autorización, cifrado, 2FA, gobernanza, infraestructura, riesgos, decisiones pendientes |
| [`backend.md`](backend.md) | Referencia y guía | Reglas de arquitectura, código, seguridad y pruebas de `apps/api` |
| [`frontend.md`](frontend.md) | Referencia y guía | Sistema de diseño, componentes, `DataTable`, i18n, seguridad en el navegador |
| [`database.md`](database.md) | Referencia | Diseño de la base de datos y RLS ("cómo quedará al final") |
| [`architecture.md`](architecture.md) | Explicación | Monolito modular, procesos, módulos, capas, multitenancy, estructura del repositorio y flujo de un caso de uso sensible |
| [`adr/`](adr/README.md) | Explicación | ADR 0001 a 0022 y 0025 a 0030 (aceptadas); 0023 y 0024 (propuestas) |
| [`threat-model.md`](threat-model.md) | Referencia | STRIDE por módulo; borrador de la fase 0, actualizado con la fase 1a en `identity`, `access` y `notification` |
| [`runbooks/`](runbooks/README.md) | How-to | Rotar DEK, restaurar respaldo, fuga de base de datos, usuario o servidor comprometido, transferir Raíz, dar de alta una organización, usar un código de emergencia, configurar el correo y operar con una sola instancia; borradores pendientes de ensayo |
| [`../odd/tasks/`](../odd/tasks/phase-0-foundations.md) | Seguimiento | Especificaciones numeradas (`S#`), tareas y bitácora por funcionalidad: [fase 0](../odd/tasks/phase-0-foundations.md), [identidad](../odd/tasks/phase-1a-identity.md), [cierre de la fase 1a](../odd/tasks/phase-1a-closure.md) y [bóveda, fase 1b (planificada, no iniciada)](../odd/tasks/phase-1b-vault.md) |
| [`../CLAUDE.md`](../CLAUDE.md) | Referencia | Reglas no negociables para el desarrollo con agentes |

## Mantenimiento

- Cada decisión de arquitectura nueva se registra como ADR (ver [`adr/README.md`](adr/README.md)).
- Los documentos se versionan en el mismo commit que el código que describen.
- Los documentos de `business/` describen reglas de negocio en lenguaje natural: no incluyen código, nombres de funciones, tablas ni rutas de API. Si una regla de negocio cambia en el plan, se actualiza ahí primero.
- Terminología fija: Raíz, Administrador, Líder, Operador (actores); KEK y DEK (claves); USE, VIEW, EDIT y MANAGE (niveles de compartición).
- Sugerido para CI: `markdownlint` y un verificador de enlaces sobre `docs/` y los `README.md` (aún no configurados).
