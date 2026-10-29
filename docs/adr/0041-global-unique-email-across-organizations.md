# ADR 0041: El correo es único en toda la plataforma mientras una persona pertenezca a una sola organización

- **Estado**: Aceptada (2026-10-28). Redactada por Ingeniería para cerrar `TODO.md` C4; el dueño la aceptó el mismo día.
- **Fecha**: 2026-10-28
- **Referencias**: [`plan.md`](../../plan.md) ("Identidad y organizaciones"); [ADR 0006](0006-multitenancy-ready-rls.md) (aislamiento por filas) y [ADR 0021](0021-pre-authentication-access-with-rls.md) (consultas previas al ingreso); [`docs/database.md`](../database.md); `TODO.md` C4.

## Contexto

El correo de ingreso es único en toda la plataforma: la columna `users.email` tiene una restricción `unique` global (migración 0002) y el ingreso busca a la persona por correo antes de conocer su organización. El plan lo dice así para la primera versión y deja la separación entre `identities` y `memberships` como decisión futura, que no se redacta hasta que se necesite.

Lo que falta es la política cuando se invita a un correo que ya existe **en otra organización**. Hechos verificados en el código:

- Al invitar, la comprobación de "correo ya registrado" (`existsByEmail`) corre bajo el aislamiento por filas: solo ve usuarios de la propia organización. Por eso la invitación a un correo de otra organización **se crea y se envía**.
- Al aceptarla, la restricción única global rechaza el alta y la persona recibe un conflicto (409). La invitación queda sin completarse hasta que vence.
- Quien invita no se entera de la colisión: no se le revela que el correo existe en otra organización.

## Decisión

Se mantiene la unicidad global del correo y **no se revela a quien invita** que el correo existe en otra organización. Reglas:

- Invitar a un correo de otra organización no falla al invitar (no hay consulta entre organizaciones que filtre su existencia).
- Al aceptar, el conflicto solo lo ve quien posee el enlace de la invitación, es decir, quien controla ese buzón; no aprende nada que no supiera.
- La invitación que no puede completarse vence por su plazo normal y no deja usuario ni datos a medias.
- Una misma persona en varias organizaciones sigue fuera de alcance: se resuelve con `identities` y `memberships` cuando exista la necesidad, en un ADR propio.

## Alternativas consideradas

- **Rechazar al invitar con una consulta global**: revelaría a un Administrador qué correos usa la plataforma en otras organizaciones y exigiría una consulta que atraviese el aislamiento. Se descartó por seguridad.
- **Responder siempre "invitación enviada" y avisar por correo al dueño existente**: no revela nada, pero agrega un correo nuevo y un caso de uso sin demanda real. _(inferida del plan)_ Queda como mejora si aparece el caso.
- **Introducir `identities` y `memberships` ya**: el plan lo difiere a propósito y cambia el modelo de acceso entero. Se descartó por alcance.

## Consecuencias

- **Positivas**: no hay filtración entre organizaciones ni consultas que salten el aislamiento; no se cambia el modelo.
- **Negativas o costos**: quien invita ve una invitación pendiente que nunca se completa y no sabe por qué; hay que explicárselo en la guía de operación y, si el caso se repite, decidir la alternativa del aviso por correo.
- **Verificación**: prueba de integración que invita desde la organización A a un correo de la B y comprueba que la invitación se crea, la aceptación devuelve conflicto y no queda ningún usuario nuevo. La prueba está escrita en `apps/api/test/invitation-cross-org-email.e2e.test.ts` (TODO.md C4a); falta confirmarla en verde.
