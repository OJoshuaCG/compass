# Grupos: crear, listar, administrar miembros y elegir grupo al compartir

Ruta protegida (acceso y auditoría), encargada por el dueño el 2026-11-13: "Adelante con ello, tanto pantalla frontend como la logica backend".

## Especificaciones (lo pedido)

- S1: "Adelante con ello, tanto pantalla frontend como la logica backend" (listado de grupos y selector de grupo al compartir).
- S2: Reglas de negocio vigentes (`docs/business/permissions-and-sharing.md` §2.3): crear grupos y gestionar miembros son permisos de techo 2; compartir con un grupo exige que el gestor del grupo tenga MANAGE sobre la cuenta; con acceso directo y por grupo vale el nivel más alto.
- S3 (supuestos míos, conservadores, por confirmar): quien crea el grupo queda gestor; administrar miembros exige ser gestor o Administrador+; el gestor es Líder o superior; un grupo nunca se queda sin gestor; un grupo no visible responde 404 con negación auditada; sin migración ni permiso nuevo (los permisos y las tablas ya existían).

## Tareas

| ID | Tarea | Estado |
| --- | --- | --- |
| G1 | Contratos, códigos de error, textos de error, lista blanca de auditoría | Hecha |
| G2 | `ManageGroups`, puerto, almacén PostgreSQL, controlador y cableado | Hecha |
| G3 | Pruebas: dominio/caso de uso (`manage-groups.test.ts`), integración con PostgreSQL (`groups.integration.test.ts`), matriz de autorización | Hecha: `manage-groups.test.ts`, matriz de autorización e integración con PostgreSQL (4 de 4) en verde el 2026-11-13 |
| G4 | Pantalla web de grupos y selector de grupo al compartir | Hecha: `groups.test.tsx`, `groups-model.test.ts`, `shares.test.tsx` e `inbound-view-shares.test.tsx` en verde (78 de 78, 2026-11-13) |
| G5 | Revisión ciega (`jd-judge-a`, `jd-judge-b`) y regla rota a propósito | Hecha: un defecto confirmado por ambos, corregido; mutación en `canManageGroupMembers` detectada por `manage-groups.test.ts` y restaurada |
| G7 | Decisiones del dueño: rotación al quitar miembro, rango del gestor, carrera con la baja | Pendiente |
| G6 | Revisión humana de las pruebas marcadas `SENSIBLE` | Pendiente |

## Bitácora

- 2026-11-13: backend construido sin migración ni dependencias nuevas. `pnpm --filter @iam/api typecheck` y `lint` en verde. Documentado en `docs/backend.md`.
- 2026-11-13 (revisión ciega): ambos jueces confirmaron que `listMembers` no auditaba la negación de un grupo existente pero no visible; corregido (usa `denyAsNotFound`) y la prueba afirma `auditDenial`. Sin bloqueos ni escalada de privilegios.
  - Solo el juez B, crítico y de negocio ambiguo: `removeMember` corta el acceso por grupo sin crear tareas de rotación (`permissions-and-sharing.md` §6.3 no cubre quitar un miembro de forma explícita). Pregunta hecha al dueño; sin implementar.
  - Sospechas de ambos, sin verificar: un gestor degradado conserva el control; un Líder gestor puede quitar a un Administrador; carrera entre `addMember` y la baja de la persona (`addMember` no bloquea la fila del usuario); la baja borra membresías sin comprobar el último gestor.
  - Solo el juez B, sin verificar: ver todos los grupos con solo tener un permiso de grupos; descripción solo con espacios queda como cadena vacía; Unicode NFC/NFD en el nombre.
  - Huecos de prueba señalados: la integración solo prueba `PgGroupStore`.
- 2026-11-13 (web): `frontend-developer` construyó la pantalla `/groups` y el modo Grupo al compartir. En las pruebas, un stub de 500 debía fallar hasta pulsar «Reintentar» porque el cliente de consultas reintenta los 5xx; y el fixture de `shares.test.tsx` «is reachable from the accounts screen» estaba desactualizado respecto al contrato `AccountListItem` desde `92be743` (fallo previo a este lote).
