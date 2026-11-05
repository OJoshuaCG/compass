# Salida de personal: qué pasa con las cuentas cuando su responsable se va (P1)

**Estado: decisiones tomadas y confirmadas (2026-11-04).** Es ruta protegida (identidad, acceso, bóveda). El dueño autorizó el 2026-11-04 construir lo que se desprende de sus respuestas; la implementación se sigue en `odd/tasks/owner-decisions-2026-11-04.md` (T3).

Revisaron el diseño dos jueces ciegos (`jd-judge-a` y `jd-judge-b`); coinciden en que **no es ejecutable tal cual**. Regla en lenguaje de negocio: [`docs/business/governance.md`](../../docs/business/governance.md) §2.4.

## Especificaciones (lo pedido)

Regla del dueño, en sus palabras: si la persona que sale era la única responsable de una cuenta, pasa al superior de primer nivel; si no, al siguiente nivel superior; y por último a un usuario del mismo nivel; si no, a ninguno. Otra opción que mencionó: que su perfil siga vivo para consultar sus credenciales.

Fuente previa: TODO P1 y preguntas abiertas de `governance.md` (2) y `actors-and-hierarchy.md` (8).

## Regla corregida (propuesta)

1. Antes de mutar nada, calcular las cuentas sin responsable activo tras la salida.
2. Por cada una, subir por la cadena de superiores hasta el primer candidato que califique. Califica quien ya tiene los permisos de compartir, de editar credenciales y de gestionar rotación, y está en el subárbol de quien da la baja.
3. Conceder la gestión a ese candidato, con auditoría por cuenta.
4. Si nadie califica dentro del subárbol: seguir subiendo hasta el Administrador más cercano que tenga esos permisos, aunque esté fuera del subárbol de quien da la baja; concederle la gestión y notificarle. Si tampoco hay ninguno: no conceder nada, dejar la cuenta sin responsable y emitir alerta por el outbox a Administrador y Raíz.
5. Generar informe de baja de solo lectura y tareas de rotación.

## Hallazgos de los jueces (acordados)

- **(a) El perfil vivo es incompatible con la seguridad.** La baja corta sesiones y acceso, y la vista de acceso efectivo no mira el estado del usuario, así que un perfil vivo seguiría viendo secretos. Alternativa segura: informe de baja de solo lectura para el nuevo responsable (qué cuentas y credenciales conocía) más tareas de rotación.
- **(b) Eliminar el paso «usuario del mismo nivel».** Entrega la gestión sobre secretos a un par elegido por el sistema, sin autoridad jerárquica y de forma no determinista. La cadena de superiores siempre termina en la Raíz activa.
- **(c) Concesión automática salta el doble control.** Compartir exige el permiso de compartir y la gestión de la cuenta, y nadie comparte más que su nivel. El candidato solo cuenta si ya tiene los permisos de compartir, editar credenciales y gestionar rotación, y está en el subárbol de quien da la baja. Si nadie califica, no se concede nada y se alerta.
- **(d) Cálculo de «cuentas sin responsable activo».** La vista de acceso efectivo no filtra el estado del usuario: hay que unir con usuarios activos, excluir a quien sale y sus membresías de grupo, y hacerlo **antes de mutar**.
- **(e) Alta de comparticiones.** Falla si el elegido ya tiene una compartición viva o vencida (índice único): subir de nivel o revocar la previa.
- **(f) Tareas de rotación.** Asignatario obligatorio (respaldo: la Raíz) con permiso de gestión de rotación (techo de rango 2); deduplicación propia para el disparador `user_deactivated`; el criterio de «credenciales que conocía» no se limita a revelaciones de los últimos 180 días: en una baja se rotan todas las credenciales vivas de las cuentas donde tuvo acceso de ver o más, con tope por transacción documentado.
- **(g) Bloqueos.** Orden: primero el bloqueo de jerarquía, luego las cuentas con una sola sentencia ordenada por id y `FOR UPDATE`, y toda la auditoría después del último bloqueo de cuenta. Una baja con miles de cuentas retiene el bloqueo de jerarquía de toda la organización: poner tope y medirlo, o diferir a trabajo asíncrono con la baja inmediata (sesiones y estado) en la transacción síncrona.
- **(h) Auditoría y ubicación.** Auditar por cuenta (concesión con motivo `offboarding` y receptor), no solo contadores. El adaptador vive en el módulo de bóveda (y en acceso para grupos) y se cablea en el contenedor, no en `directory`.
- **(i) Suspensión.** Se deja igual: no reasigna; el suspendido conserva la gestión y sus comparticiones. Documentarlo.
- **(j) Documentación.** Requiere enmienda al ADR 0009 y regla nueva en `docs/business/`.

## Decisiones que necesita el dueño

- [x] Quitar el perfil vivo y el paso «usuario del mismo nivel»: aceptado (hallazgos a y b).
- [x] Plazo de rotación tras una baja: 72 horas, con prioridad alta para las credenciales que la persona reveló.
- [x] Qué pasa si nadie califica: se asigna al Administrador más cercano hacia arriba que tenga los permisos, aunque esté fuera del subárbol de quien da la baja, y se le notifica; si no hay ninguno, la cuenta queda sin responsable y se alerta a Administrador y Raíz. Confirmado por el dueño el 2026-11-04: «Si, es correcto, asignar y notificar o si no se puede , tambien alertar».
- [x] Informe de baja de solo lectura: sí.
- [x] El suspendido conserva sus comparticiones (sin cambio).
- [x] Baja síncrona, de una sola vez, con medición; el trabajo asíncrono queda para cuando la medición lo pida.

## Tareas (no iniciadas; se desbloquean con la decisión)

- [x] Encargo humano explícito para tocar ruta protegida (2026-11-04: «Adelante con llevar a cabo todas las tareas que sean posibles, sin problema puedes llevar a cabo todas las tareas que conllevan o involucren las respuesta brindadas»).
- [ ] Enmienda al ADR 0009 (el aceptado no se edita sin decisión; se propone como adenda o ADR nuevo en borrador, marcado «propuesto»).
- [ ] Regla de negocio nueva en `docs/business/` (sin código) y retirada de las preguntas abiertas.
- [ ] Puerto en la baja de usuarios y adaptadores en bóveda y acceso; cableado en el contenedor.
- [ ] Cálculo previo de cuentas sin responsable activo (hallazgo d).
- [ ] Búsqueda de candidato por la cadena, con manejo del índice único de comparticiones (b, c, e).
- [ ] Alerta por el outbox cuando nadie califica.
- [ ] Informe de baja y tareas de rotación con deduplicación propia (a, f).
- [ ] Orden de bloqueos y tope medido (g); auditoría por cuenta (h).
- [ ] Pruebas: matriz de autorización, aislamiento, bloqueos y rotura intencional de la regla. Las de autorización y aislamiento las escribe o revisa una persona.

## Bitácora

- 2026-10-30: revisión ciega de dos jueces; ambos coinciden en que el diseño no es ejecutable tal cual. Se documenta la propuesta corregida y los hallazgos (a)–(j), y se bloquea P1 a la decisión del dueño. Solo documentación: no se tocó código, migraciones ni ADR aceptados; no se ejecutaron pruebas.
- 2026-11-04: el dueño respondió las decisiones en el chat: quitar a y b, rotación en 72 h con prioridad alta para lo revelado, sin responsable y alerta si nadie califica, informe de baja, el suspendido conserva sus comparticiones, baja síncrona con medición. A pregunta suya queda en evaluación asignar la cuenta al Administrador más cercano cuando nadie califique dentro del subárbol. Por defecto el Administrador tiene todos los permisos de techo 1 o mayor (`apps/api/src/modules/access/domain/system-roles.ts:44`), así que con las plantillas del sistema la cadena casi siempre encuentra uno. Solo documentación.
- 2026-11-04 (más tarde): el dueño confirmó la variante («Si, es correcto, asignar y notificar o si no se puede , tambien alertar») y autorizó construir lo que se desprende de sus respuestas. Se actualiza el paso 4 de la regla corregida. Solo documentación.
