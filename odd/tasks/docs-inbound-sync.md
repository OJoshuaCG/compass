# Actualización de la documentación tras los códigos entrantes (DOC)

Objetivo: que la documentación refleje lo construido de IC-1 a IC-6d-5 (commits a87c094..a63356f) y que el estado de cada tarea diga lo que de verdad está hecho o pendiente. Rama: `main`. Estrategia de entrega: un commit por grupo de documentos. Pruebas: no aplica (documentación pasiva); la verificación es estructural (enlaces, formato con `pnpm exec prettier --check`) y por evidencia en el código.

## Especificaciones

- **S1.** Pedido del dueño, textual: «Adelante con la actualizacion, revisar de todas las tareas cuales ya estan hechas o cuales estan pendientes realmente».
- **S2.** Corregir todo lo que hoy es falso o está desactualizado por el trabajo de códigos entrantes. Cada afirmación nueva debe poder comprobarse en el código (ruta:línea o commit). No se agregan reglas de negocio nuevas: solo se describen las ya decididas (ADR 0045, enmiendas del 2026-10-30, `odd/tasks/inbound-codes.md` § «Decisiones»).
- **S3.** El ADR 0045 sigue en «Propuesta» (opción A, supuesto mío; ver L2): se agrega una nota de lo implementado y de que falta la ratificación del dueño. No se cambia su estado.
- **S4.** Revisar el estado real de todas las tareas de `odd/tasks/*.md` y del plan de `docs/handoff.md`, y corregir los encabezados de estado que no coinciden con la evidencia.
- **S5.** Convenciones: documentación en español neutro; `README.md` y `docs/business/` sin código (solo texto, tablas y enlaces); skill `cognitive-doc-design` (lo importante primero, secciones cortas, tablas). Imitar el estilo del documento que se edita y no reescribir lo que no cambió.

### Brechas encontradas (auditoría del 2026-11-03; evidencia de cada una)

**Técnicos (T1)**
- `docs/backend.md:101` dice que `inbound-codes` solo tiene la capa de dominio (IC-1) y no está cableado; hoy tiene 6 controladores en `apps/api/src/modules/inbound-codes/interface/`, adaptadores pg y la parte IMAP/MIME. `:38` lo lista entre módulos sin adaptadores. `:95` dice «28 permisos» (hoy 34, `apps/api/src/modules/access/domain/permission-catalog.ts`). La fila `notification` (`:99`) y §6.5 (`:372`) no mencionan el aviso a la Raíz por outbox al revelar un restablecimiento (`notify-reset-revealed.ts`), que exige `OUTBOX_WORKER_ENABLED`. §6.3.2 no remite a la configuración propia del worker (`DATABASE_URL_INBOUND_WORKER`, etc.).
- `docs/database.md`: la tabla de migraciones (`:20-37`) no tiene la `0029_inbound_mail_connections.sql` (`mail_source_connections`, `mail_source_poll_state`, `auth.list_pollable_inbound_sources()`, grants del worker incluido `select` sobre columnas de `data_keys`). `:84`: la fila de `iam_inbound_worker` no tiene esos grants. `:506`: `resource_type` «hoy solo `account`»; hoy `account`, `mail_source`, `mail_view` (`0024_inbound_codes_tables.sql:217-218`). §4 y §5 sin las tablas inbound. §9 (`:655`, `:663`, `:686-689`, `:718-749`) dice que las tablas «no existen todavía» y usa nombres viejos (`mailboxes`, `extracted_codes`); las reales son `mail_sources`, `mail_views`, `inbound_items`, `inbound_receipts` (y las de 0029). No agregar filas de 0028, 0031, 0032 si son de otras funciones salvo que sea trivial y verificable; anotarlo.
- `docs/frontend.md` §18 (`:459-490`): falta `features/inbound-codes` y las rutas `/inbound`, `/inbound/views/$viewId`, `/inbound/sources`, `/inbound/view-settings`, `/inbound/views/$viewId/shares` (`apps/web/src/app/router.tsx`) y los enlaces de navegación por permiso (`apps/web/src/routes/app-layout.tsx`). §9 (`:317-334`): falta que los códigos y los restablecimientos revelados viven solo en el estado local del componente, y que el formulario de conexión IMAP no manda `Idempotency-Key` para que la contraseña no quede en la caché de idempotencia. Falta que `ShareWithPersonForm` y `SharesTable` del feature `shares` son genéricos y se reutilizan (a63356f).

**Operación (T2)**
- `docs/deployment.md` §2.1 (`:160-167`): falta el proceso periódico `inbound-poll` (`apps/api/src/main.inbound-poll.ts`); el contenedor solo arranca `main.http.js` (`docker/start.sh`). §2.4 paso 2: `iam_inbound_worker` también se crea (`db/src/bootstrap.ts`) y necesita LOGIN (runbook `inbound-poll.md`). §2.6: el aviso a la Raíz necesita `OUTBOX_WORKER_ENABLED=true`.
- `docs/observability.md:28`: falta el evento `inbound.message` del sondeo (`log-poll-observer.ts`).
- `docs/runbooks/inbound-poll.md:3`: enlace roto a `../adr/0045-inbound-codes-imap-polling.md` (el archivo es `0045-inbound-codes-mail-and-sms.md`); falta decir que fuentes y conexiones se configuran en `/inbound/sources`; `LOCAL_KMS_KEY_FILE` no está listado. `docs/runbooks/rotate-dek.md`: no dice que `main.reencrypt.ts` también recifra las contraseñas de buzones.
- `README.md` raíz: `:28` pone la lectura de correos como pendiente; `:9` no nombra `iam_inbound_worker`.

**Seguridad (T3)**
- `docs/threat-model.md:19` deja `inbound-codes` fuera de alcance; `:207` pide agregar su sección al abrirlo. Amenazas a cubrir (todas ya mitigadas o anotadas en el ADR 0045 y el código): SSRF y DNS rebinding (`network-guard.ts`), `Authentication-Results`/DKIM falsificados, aislamiento del analizador MIME (proceso hijo), compromiso del worker (ADR 0045, amenazas), toma de cuentas con enlaces de restablecimiento (revelación con motivo, reautenticación, auditoría crítica, aviso a la Raíz, tareas de rotación), contraseñas de buzones cifradas por el módulo de criptografía.

**Negocio (T4)** — sin código
- `docs/business/vault.md` §14: `:203` «Estado: propuesta, no implementada»; `:214` dice que el sistema no entra a bandejas ni guarda contraseñas de correo (hoy sondea por IMAP y guarda la contraseña cifrada; ADR 0045 enmienda «camino B sustituye al camino A»); `:281` presenta el camino B como descartado; `:274` pregunta abierta 2 ya decidida (IMAP contra el servidor propio); §14.3 y §14.4 marcan como «(propuesta)» reglas aprobadas (techo 1 de `inbound.reveal_reset`; quien crea recibe MANAGE).
- `docs/business/roadmap-and-status.md`: `:39` fase 4 «en propuesta» (está construida salvo los adaptadores reales, IC-8 bloqueada); `:98` «28 permisos»; `:191` dice USE sobre la cuenta, el modelo usa USE sobre la vista.
- `docs/business/permissions-and-sharing.md`: `:11` «28 permisos»; §2.1–2.5 sin `inbound.read_codes` (techo 3), `inbound.configure` (2), `inbound.reveal_reset` (1); §8 (`:247-255`) sin la fila de revelar un restablecimiento (reautenticación, motivo, auditoría crítica); `:144`/`:145` cuentas de plantillas Líder y Operador (recalcular desde `system-roles.ts`, no inventar); `:178` las comparticiones también aplican a fuentes y vistas de correo; `:249` «Revelar una contraseña | Sí | Sí» está mal desde que se quitó el motivo el 2026-10-31 (`docs/handoff.md`).
- `docs/business/overview.md:91`, `:104`: la lectura de códigos de correo figura como fase futura.

**Decisiones (T5)**
- ADR 0045: el resumen (`:3`, `:9`) dice «camino A, sin IMAP ni contraseñas»; `:287`, `:302` citan «migración 0026» (la real es 0029). Falta nota de lo implementado (IC-1 a IC-6d-5). `docs/adr/README.md` fila 0045: «Antes de implementar la rebanada de migraciones (IC-2)» ya no aplica.

**Estado (T6)**
- `docs/handoff.md`: sin mención de códigos entrantes en §1 (`:7-14`), §4 (`:57-67`), módulos y pantallas (`:45-46`), decisiones abiertas §5; `:187` (worker), `:197` «0001 a 0041», `:10` «28 permisos». Encabezados de estado de `odd/tasks/*.md` desactualizados, según la auditoría de tareas (ver L3).

## Tareas

| ID | Especificación | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2, S5: backend, database, frontend | delegada (`general-purpose`, regla del proyecto para documentación) | hecha | a320481 |
| T2 | S2, S5: deployment, observability, runbooks, README | delegada | hecha | 18cf500 |
| T3 | S2, S5: threat-model | delegada | hecha | 5711bc5 |
| T4 | S2, S5: documentos de negocio | delegada | hecha | commit de cierre (este documento va en el mismo) |
| T5 | S3: ADR 0045 e índice | en línea | hecha | 6eb85ec |
| T6 | S1, S4: estado de tareas y handoff | en línea, tras la auditoría de tareas | hecha | 066308f (odd/tasks), 448d921 (handoff) |

Los escritores corren de a uno (un solo escritor a la vez).

## Bitácora

- **L1** (2026-11-03, pedido textual): «Adelante con la actualizacion, revisar de todas las tareas cuales ya estan hechas o cuales estan pendientes realmente».
- **L2** (2026-11-03): el dueño no eligió explícitamente entre A (ADR sigue en Propuesta) y B (pasarlo a Aceptado). Se toma A, la conservadora y recomendada; se puede cambiar con una línea si el dueño ratifica.
- **L3** (2026-11-03): auditoría de documentos hecha por un agente de solo lectura; dos afirmaciones comprobadas a mano (`backend.md:101`, `vault.md:214`). `git status` de `docs/` y `README.md` limpio: ningún documento tiene cambios de otra sesión. Auditoría del estado de tareas en curso.
- **L4** (2026-11-03): T5 hecha (6eb85ec). T1 hecha (a320481). Se comprobaron a mano los 34 permisos de `permission-catalog.ts` y el comentario del `PUT` sin `Idempotency-Key` en `client.ts`. El escritor corrigió dos puntos de la lista: el formulario usa `PUT`, y el revelado exige además MANAGE sobre la vista.
- **L5** (2026-11-03): T2 hecha (18cf500). Se corrigió una fila del README que juntaba las fases 4 y 5 como construidas: la 5 (SMS) sigue pendiente. Se comprobó en `db/src/bootstrap.ts` que el rol `iam_inbound_worker` se crea en el bootstrap.
- **L6** (2026-11-03): T6 hecha, con los estados de `odd/tasks` en 066308f y `docs/handoff.md` en un commit aparte. Cada cambio se apoya en un commit existente (c19a52f, 159f866, c9916e7, f1b623c, 314828e, bfa376b, 9026a1d, 0c53dac, 1ae17b9). Sin cambio en `phase-1a-identity.md` T7: la auditoría lo dio por hecho solo por inferencia. `TODO.md` queda fuera de alcance; su fila T9 todavía dice «SES entrante o SMTP propio», aunque la vía IMAP ya está decidida.
- **L7** (2026-11-03): T3 hecha (5711bc5). Se comprobaron a mano dos citas de §4.9 (`dkim-gate.ts:187`, `reveal-inbound-resets.ts:209`). El escritor dejó como abiertos los controles sin evidencia en el código: firewall de salida, política del KMS y alertas de `Decrypt`.
- **L8** (2026-11-03): T4 hecha. Conteo comprobado a mano en `permission-catalog.ts`: techos 0/1/2/3 con 2/9/14/9 permisos, es decir 34 en total, 23 en la plantilla Líder (techo 2 o más) y 8 en la de Operador (techo 3, menos revelar contraseña). La frase de autenticidad en dos fases sale del ADR 0045:237. Quedan fuera de alcance y anotados: `permissions-and-sharing.md:16,21,33-34` dice que las comparticiones están «pendiente»; `two-factor.md` y el criterio de salida de 1b hablan de cinco métodos, aunque la entrega por celular pasó a v1.1; `TODO.md` T9.
- **L9** (2026-11-03): lote cerrado. S1 a S5 cubiertas. Verificación estructural: prettier en verde en cada grupo y enlaces relativos nuevos comprobados. Sin pruebas: la documentación es pasiva.
