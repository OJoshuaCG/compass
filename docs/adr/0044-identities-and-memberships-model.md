# ADR 0044: Modelo de identidades y pertenencias (`identities` y `memberships`)

- **Estado**: Propuesta. Borrador de Ingeniería para `TODO.md` C5. **No bloquea la fase 1**: la decisión vigente sigue siendo el [ADR 0041](0041-global-unique-email-across-organizations.md) hasta que una persona decida lo contrario.
- **Fecha**: 2026-10-29
- **Referencias**: [`plan.md`](../../plan.md) sección "Identidad y organizaciones" (línea 192); [ADR 0006](0006-multitenancy-ready-rls.md); [ADR 0021](0021-pre-authentication-access-with-rls.md); [ADR 0004](0004-server-side-encryption-kms-per-org-dek.md); [ADR 0041](0041-global-unique-email-across-organizations.md); [`docs/database.md`](../database.md) §9; `db/migrations/0002_organizations_identity.sql` y `0008_auth_functions.sql`; `apps/api/src/modules/identity/application/login.ts`; `TODO.md` C5.

## Resumen

**Recomendación (confianza alta, alrededor de 85 %):** mantener hoy una fila de `users` por organización con correo único global (ADR 0041) y **separar `identities` de `memberships` solo cuando exista una persona real que deba entrar a varias organizaciones**. Si llega, la tabla `users` actual hace de pertenencia y se le agrega una identidad encima. La decisión que sí conviene tomar ahora es **qué se compartirá entre organizaciones y qué no** (sobre todo el segundo factor), porque condiciona el costo.

## Contexto

El plan fija que en la v1 cada usuario pertenece a una organización y el correo es único global, y deja `identities` y `memberships` como "ADR futuro" (`plan.md` línea 192). `TODO.md` C5 pide ese ADR; su referencia a `docs/adr/README.md:55` estaba desactualizada (el aviso está hoy en la sección "ADR futuro ya anunciado en el plan" del índice y en el plan).

Estado actual verificado:

- **Correo**: `users.email` es `unique` global (migración 0002, tabla `users`). `invitations` guarda el correo por organización y evita dos invitaciones pendientes al mismo correo en una misma organización.
- **Ingreso**: `auth.find_login_by_email(p_email)` busca por correo **sin conocer la organización** y devuelve una fila (usuario, organización, estado, hash de contraseña) (migración 0008). `login.ts` (líneas 81 a 106) asume una sola fila: verifica contraseña, y con esa fila abre una sesión en la organización que la fila indica y fija el contexto de organización desde ella. El límite de intentos usa `login:<correo>`.
- **Sesiones**: `sessions` guarda `organization_id` y `user_id` y es la que fija la organización de cada petición (`session-service.ts`; `auth.find_session_by_token_hash`). El segundo factor verificado queda en la sesión (`mfa_at`).
- **Todo cuelga de `users (organization_id, id)`**: unas 28 claves foráneas compuestas en seis migraciones (conteo de `references users (organization_id, id)` en `db/migrations`), incluidos `audit_events.actor_id`, comparticiones, grupos y sesiones. El aislamiento por filas se basa en `organization_id` y en esas claves compuestas.
- **Credenciales de ingreso por usuario y organización**: `user_passwords`, `webauthn_credentials`, `user_recovery_codes` y **`user_totp_factors`**, cuyo secreto se cifra con la DEK **de la organización** y un AAD que incluye `org_id` (migración 0002, comentario de la tabla; ADR 0004).
- **Rangos**: la jerarquía de cuatro actores, `rank`, `managed_by` y "una sola Raíz activa por organización" son **por organización** (`users_one_active_root`, restricciones de `users`).
- **Lo que hoy ocurre con una persona en dos organizaciones**: no puede con el mismo correo. La invitación a un correo ya usado en otra organización se envía y falla al aceptarla (ADR 0041). Existe una salida manual: el patrón de la columna acepta un correo distinto por organización, por ejemplo con un alias que el proveedor de correo entregue al mismo buzón (no verificado que el dominio de la empresa lo permita).
- **Quién podría necesitarlo**: la escala de referencia son menos de 20 clientes y unas 100 personas (`docs/handoff.md` sección 5). Si el equipo del propietario atenderá varias organizaciones cliente, ese es el caso real; el repositorio no lo afirma.

## Opciones

### A. Mantener una fila por organización con correo único global (ADR 0041)

- **A favor**: costo cero; sin cambios en ingreso, sesiones, RLS ni pruebas; ya está decidido y aceptado.
- **En contra**: una persona en dos organizaciones necesita dos cuentas (dos correos, dos contraseñas, dos segundos factores). No hay cambio de organización. Es incómodo, pero seguro.

### B. Separar ya `identities` y `memberships`

- **Qué cambia**:
  - `identities` (persona: correo, quizá contraseña) **no tiene `organization_id`**: es una excepción a la regla de `CLAUDE.md` "toda tabla lleva organización, índice y política de aislamiento". Su aislamiento tendría que ser distinto (acceso solo por funciones `auth.*` de lectura mínima, como el ADR 0021, y sin política de lectura general para `iam_app`) porque un `select` sin filtro revelaría a las personas de todas las organizaciones.
  - `users` pasa a ser la pertenencia: conserva su `id` y `(organization_id, id)`, así las 28 claves foráneas, la auditoría y el RLS **no cambian**. Se agrega `identity_id` y una restricción única `(identity_id, organization_id)`.
  - `auth.find_login_by_email` devuelve **varias** filas; el ingreso necesita un paso de elección de organización **después** de verificar contraseña y segundo factor.
  - El correo de `users` se vuelve dato de la identidad; la unicidad pasa a `identities`.
- **Decisiones de fondo que obliga a tomar**:
  - **Segundo factor**: `user_totp_factors` se cifra con la DEK de una organización. Un factor de la **identidad** no pertenece a ninguna organización, así que no tendría DEK que lo proteja: exigiría una clave de plataforma nueva (superficie criptográfica nueva, ADR propio). Lo simple es que el segundo factor y las claves de acceso queden **por pertenencia** (se registran de nuevo en cada organización) y solo el correo y la contraseña suban a la identidad.
  - **Sesiones**: una sesión por pertenencia (cambiar de organización abre otra sesión; se decide si se exige reautenticar) o una sesión de la identidad con una organización activa (cambia el guardia de sesión y cómo se fija el contexto). La primera encaja con el modelo actual y toca menos.
  - **Baja**: hoy `DeactivateUser` es por organización. Una persona dada de baja en una organización sigue activa en las demás; una baja de toda la plataforma no existe en el modelo de cuatro actores y habría que definir quién la puede hacer.
  - **Privacidad** (ADR 0041): hoy no se revela a quien invita que el correo existe en otra organización. Con identidades, invitar a un correo existente es "agregar una pertenencia", y se debe aceptar iniciando sesión como esa identidad, sin revelar nada antes.
- **Costo de migración**: expandir y contraer sobre tablas que son rutas protegidas (identidad, acceso, migraciones con aislamiento): crear `identities`, rellenarla uno a uno desde `users`, agregar `identity_id`, cambiar la función de ingreso, retirar `users.email` único. Las pruebas de aislamiento y las de ingreso se rehacen en parte.
- **A favor**: resuelve la necesidad de raíz y es la forma que el plan ya anticipa.
- **En contra**: costo alto y riesgo en el ingreso y el aislamiento antes de tener un caso real; decisiones de seguridad (segundo factor, baja) que hoy se tomarían sin requisitos.

### C. Diferir con un disparador explícito (recomendada)

- Se mantiene A y se registra aquí el diseño objetivo (B con segundo factor por pertenencia, sesión por pertenencia) para no rediseñar desde cero.
- **Disparador**: una persona concreta que debe entrar a más de una organización, o una decisión de producto de ofrecerlo. En ese momento este ADR pasa a "Aceptada" con las preguntas resueltas, o se reemplaza por otro.
- **Sin trabajo preparatorio en el código**: no se recomienda cambiar ahora el puerto de búsqueda de ingreso para devolver una lista (sería código sin uso). Lo único que se pide es no escribir lógica nueva que suponga que el correo identifica a una organización más de lo que ya lo hace.

## Recomendación (propuesta)

Opción C. No es urgente ni bloquea la fase 1; por la misma razón no debe adelantarse mientras no haya una persona real que lo necesite. Conviene aceptar el ADR únicamente para fijar el diseño objetivo y el disparador.

## Consecuencias (si se acepta)

- **Positivas**: no se toca el ingreso ni el aislamiento antes de la prueba de penetración externa; el diseño objetivo ya está pensado y su mayor riesgo (el segundo factor sin DEK) identificado de antemano.
- **Negativas o costos**: quien necesite dos organizaciones trabaja con dos cuentas hasta entonces; si el caso aparece con urgencia, la migración se hará con presión. Una migración posterior a cargar credenciales reales exige más cuidado con el respaldo y la reversión.
- **Verificación**: ninguna en el código mientras se difiera; cuando se implemente, pruebas de aislamiento con una identidad en dos organizaciones y mutación manual de la unicidad `(identidad, organización)`.

## Preguntas abiertas para una persona

1. **¿Hay hoy una persona real que deba entrar a varias organizaciones?** Por ejemplo, personal de soporte del propietario con varios clientes. Si la respuesta es sí y es para pronto, la recomendación cambia a B.
2. ¿Segundo factor y claves de acceso por organización (re-registrar en cada una) o por identidad (exige una clave de plataforma nueva)?
3. Al cambiar de organización, ¿se pide reautenticar o basta la sesión de la identidad?
4. ¿Quién puede dar de baja a una identidad de toda la plataforma?
5. ¿Es aceptable mientras tanto el alias de correo por organización como solución provisional?

## No verificado

- El conteo de claves foráneas es de líneas que contienen `references users (organization_id, id)`; no se revisó una por una cuáles son tablas de dominio.
- Que el dominio de correo de la empresa admita alias que lleguen al mismo buzón.
- Cómo se comporta el guardia de sesión de la interfaz web ante un cambio de organización (no se leyó el código de la web).
