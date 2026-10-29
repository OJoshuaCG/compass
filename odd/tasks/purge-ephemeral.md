# Purga de datos efímeros vencidos (G1)

Objetivo: que `idempotency_keys` y `webauthn_challenges` dejen de acumular filas vencidas (`docs/database.md` §7.5) y dejar la pieza con la que los trabajos de fondo recorren organizaciones. Decisión de diseño: [ADR 0038](../../docs/adr/0038-background-jobs-traverse-organizations.md) (aceptada con confirmación pendiente de Ingeniería). Método: iteraciones hasta 5, revisión adversarial con dos revisores ciegos sobre el mismo alcance, mutación manual.

## Specs

Textual de lo pedido el 2026-10-28: "procede con G1". Y de `TODO.md` G1: "Purga de filas vencidas de `idempotency_keys` y `webauthn_challenges` (incluye un ADR corto sobre el recorrido de organizaciones, `docs/database.md` §7.5)".

- S1. Nunca se borra fuera de una organización: todo borrado corre con `app.org_id` fijado y bajo RLS.
- S2. Solo se borran filas que la aplicación ya trata como inexistentes (vencidas), con margen de gracia.
- S3. La función nueva del esquema `auth` sigue el molde de §7.3 y lleva ADR.
- S4. Una migración aplicada no se edita: se crea una nueva.
- S5. Sin dependencias nuevas; sin tocar el proceso de fondo (H1, lo decide el equipo).

## Tasks

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| T1 ADR 0038 y registro en el índice | S3 | inline | hecha |
| T2 Migración 0014: `auth.list_organization_ids()`, `DELETE` de desafíos para `iam_app`, índice por vencimiento | S1, S3, S4 | inline | hecha |
| T3 Módulo `maintenance` (`PurgeExpiredRows`), purgadores por módulo y listador de organizaciones | S1, S2 | inline | hecha |
| T4 Comando `purge` (`main.purge.ts`) con la credencial de `iam_app` | S1, S5 | inline | hecha |
| T5 Pruebas: unitarias del caso de uso; base de datos real (función, aislamiento, falla cerrada) | S1 a S3 | inline | hecha |
| T6 Documentación: `database.md` §1, §7 y §10; runbook `purge-expired-rows.md` | S3 | inline | hecha |
| T7 Revisión adversarial, mutación manual y cierre | todas | inline | hecha (queda la confirmación de Ingeniería del ADR) |

## Bitácora

- 2026-10-28: ADR 0038 redactado. Fuera de alcance, por escrito en el ADR: el proceso de fondo (H1) y la purga del outbox (se fija la regla de 7 días; se implementa con su publicador).
- 2026-10-28: Implementación. Tipos y lint en verde. Pruebas de base de datos 60 de 60 y unitarias del caso de uso 6 de 6. En esta máquina no hay Docker ni Podman y el binario de SWC no carga, así que las pruebas de base de datos corrieron contra PostgreSQL 17 nativo con un `global-setup` local (no versionado) y las unitarias sin el plugin de SWC; la CI debe correr las suites completas.
- 2026-10-28: Prueba de punta a punta del comando contra el stack local con dos organizaciones: borró solo las filas vencidas hace 2 horas en ambas; conservó las vencidas hace 30 minutos y las vigentes; una segunda corrida borró 0; sin `DATABASE_URL` falla nombrando solo la variable.
- 2026-10-28: Mutación manual, todas detectadas y revertidas: sin `GRANT DELETE` (2 pruebas fallan), `iam_auth_reader` con `name` (1), función ejecutable por `PUBLIC` (1), sin margen de gracia (1).
- 2026-10-28: Revisión adversarial con dos revisores ciegos sobre el mismo alcance congelado (los agentes `jd-judge-a` y `jd-judge-b` no existen en este entorno; se usaron dos revisores independientes con la misma instrucción). Confirmados por ambos y corregidos: (1) las pruebas no ejecutaban el SQL real de los purgadores ni el listador: nueva prueba de integración `apps/api/test/purge.integration.test.ts` con el caso de uso real; (2) la prueba de columnas de `organizations` era parcial y nada comprobaba que la política de listado fuera solo de `iam_auth_reader`: ahora se recorren todas las columnas y se verifica el rol de la política y que `iam_app` sin contexto ve cero organizaciones; (3) 409 espurio si la purga borra una clave entre `find` y `takeOver`: el servicio de idempotencia reintenta la reserva una vez (con prueba unitaria). De un solo revisor, verificado y corregido por su bajo riesgo: el `DELETE` repite el corte fuera de la subconsulta, para no borrar una fila renovada mientras esperaba su bloqueo; documentación que aún decía "no se purgan" (`database.md`, `backend.md`, `threat-model.md`). Descartado: la prueba de `TRUNCATE`, que no protegía nada (se quitó). Anotado sin corregir: `iam_migrator` es miembro de `iam_auth_reader` por `bootstrapRoles`, así que también puede listar los `id` (igual que ya lee por las políticas de la `0008`).
- 2026-10-28: Mutación de las correcciones, detectadas y revertidas: política de listado sin `to iam_auth_reader` (1 prueba falla) y servicio sin el reintento de reserva (1). Pruebas: base de datos 60 de 60; API 35 de 36 (la que falla es `unit-of-work.integration`, porque el PostgreSQL local responde en español y la prueba compara el mensaje en inglés; no es de este cambio); web, ui, i18n y contracts en verde. La carrera del `DELETE` con `takeOver` no tiene prueba automática (requiere dos transacciones concurrentes con bloqueos).
- 2026-10-28: Cerrada. Falta: confirmación de Ingeniería del ADR 0038, programar el comando en el despliegue y que la CI corra las suites con contenedores.
