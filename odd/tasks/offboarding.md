# Salida de personal: qué pasa con las cuentas cuando su responsable se va (P1)

**Estado: BLOQUEADO a la decisión del dueño.** Es ruta protegida (identidad, acceso, bóveda) y la regla de negocio no está cubierta: según `CLAUDE.md`, se propone y se detiene. No se escribe código, migración ni ADR aceptado hasta que el dueño responda las preguntas de abajo.

Revisaron el diseño dos jueces ciegos (`jd-judge-a` y `jd-judge-b`); coinciden en que **no es ejecutable tal cual**. Regla en lenguaje de negocio: [`docs/business/governance.md`](../../docs/business/governance.md) §2.4.

## Especificaciones (lo pedido)

Regla del dueño, en sus palabras: si la persona que sale era la única responsable de una cuenta, pasa al superior de primer nivel; si no, al siguiente nivel superior; y por último a un usuario del mismo nivel; si no, a ninguno. Otra opción que mencionó: que su perfil siga vivo para consultar sus credenciales.

Fuente previa: TODO P1 y preguntas abiertas de `governance.md` (2) y `actors-and-hierarchy.md` (8).

## Regla corregida (propuesta)

1. Antes de mutar nada, calcular las cuentas sin responsable activo tras la salida.
2. Por cada una, subir por la cadena de superiores hasta el primer candidato que califique. Califica quien ya tiene los permisos de compartir, de editar credenciales y de gestionar rotación, y está en el subárbol de quien da la baja.
3. Conceder la gestión a ese candidato, con auditoría por cuenta.
4. Si nadie califica: no conceder nada, dejar la cuenta sin responsable y emitir alerta por el outbox a Administrador y Raíz.
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

- [ ] Plazo de rotación tras una baja (días) y prioridad.
- [ ] Qué pasa si nadie califica (propuesta: sin responsable y alerta).
- [ ] Si hace falta el informe de baja de solo lectura.
- [ ] Si el suspendido debe conservar acceso (hoy lo conserva).
- [ ] Tope de cuentas por baja síncrona, o diferir a trabajo asíncrono (se decide con medición).

## Tareas (no iniciadas; se desbloquean con la decisión)

- [ ] Encargo humano explícito para tocar ruta protegida.
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
