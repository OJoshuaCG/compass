# Cierre de la Fase 1a · Identidad

Objetivo: dejar la Fase 1a completa según sus criterios de salida del plan antes de abrir la bóveda (1b). Es el siguiente trabajo recomendado; el detalle y el orden están en [`docs/handoff.md`](../../docs/handoff.md), sección 4, bloque A. Método: el mismo de `phase-1a-identity.md` (iteraciones hasta 5, revisión adversarial ciega, mutación manual, commits convencionales por parte).

## Specs

Las especificaciones salen de las secciones "Autenticación del propio sistema", "Actores y jerarquía: reglas formales" y "Modelo de autorización" del plan, y de la bitácora L6 y L10 de `phase-1a-identity.md`. Textuales del plan que esta tarea cierra:

- S1. "Passkeys (WebAuthn): preferidas; resistentes a phishing. Se permiten varias por usuario con nombre". Política "exigir passkeys para Raíz y Administradores".
- S2. Reglas 5 a 7 de jerarquía: cambio de rango, transferencia de responsable y bajas con reasignación; "Desactivar, suspender, cambiar rango o roles revoca las sesiones del afectado en el acto".
- S3. "Al crear la organización se generan códigos de emergencia, impresos y custodiados por dos personas fuera del sistema. Usarlos alerta a todos los Administradores y queda auditado."
- S4. "El usuario ve y cierra sus sesiones activas; su responsable puede cerrarlas todas."
- S5. "Reenviar una invitación invalida la anterior." Roles personalizados con "Sus permisos deben ser un subconjunto de los de su creador".
- S6. "Idempotency-Key obligatorio en POST que crean recursos; se guarda la respuesta 24 horas."
- S7. Contraseña inicial de la Raíz con cambio obligatorio (el indicador ya existe y no se aplica).

## Tasks

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| A1 Gestión de personas (rango, responsable, suspender, desactivar, revocar sesiones) | S2 | inline | hecha (2026-10-27) |
| A2 Passkeys y política para Raíz y Administradores | S1 | pendiente | pendiente |
| A3 Alta de organizaciones como comando de operaciones + códigos de emergencia | S3 | inline | parcial (2026-10-27): comando de alta hecho; faltan los códigos de emergencia, que requieren su propia tabla |
| A4 Cambio obligatorio de la contraseña inicial de la Raíz | S7 | inline | hecha (2026-10-27) |
| A5 Sesiones: ver, cerrar, cierre por el responsable, sincronización entre pestañas | S4 | pendiente | pendiente |
| A6 Reenvío de invitación y roles personalizados | S5 | pendiente | pendiente |
| A7 Idempotencia de las peticiones de creación | S6 | pendiente | pendiente |
| A8 Redis para límites de intentos y correo real | — | pendiente | pendiente (requiere decisión de proveedor) |
| A9 Ejecutar el CI en GitHub y añadir escáneres de seguridad | — | pendiente | pendiente |
| A10 Reautenticación en navegador real y con código de recuperación | — | pendiente | pendiente (depende de A1) |

## Log

- L1 (2026-10-27): Tarea creada a partir del análisis de continuidad. Se corrigió además un defecto hallado al probar la pila local: la comprobación de vida de la API respondía 401 con sesión activa (ahora es pública, con prueba de regresión). Se añadió `pnpm stack` para levantar la plataforma completa a mano.
- L2 (2026-10-27): Cerradas A4 y A1, y A3 de forma parcial. Evidencia: 66 o más pruebas de integración de la API (incluidas las suites nuevas de equipo y de contraseña), 8 pruebas en Chrome real (la Raíz ahora pasa por la pantalla de cambio de contraseña) y la suite completa con 547 pruebas de API, 209 de web y 58 de ui.
  - A4: el ingreso con contraseña inicial responde "cambio de contraseña requerido" antes que nada; el registro y la verificación del segundo factor se rechazan con 403 `AUTH.PASSWORD_CHANGE_REQUIRED` hasta cambiarla en `POST /auth/password/change`. Exige la contraseña actual, aplica la misma política a la nueva, impide reutilizar la actual, cuenta los intentos fallidos con el mismo límite (se reinicia al demostrar la actual) y al terminar cierra las demás sesiones de la persona. Auditoría: `auth.password_changed` y `auth.password_change_failed`. Web: pantalla `/password/change`.
  - A3 (parcial): comando `pnpm --filter @iam/api provision` con las variables `PROVISION_DATABASE_URL`, `ORG_NAME`, `ORG_SLUG`, `ROOT_EMAIL` y `ROOT_NAME`. Genera una contraseña inicial aleatoria de 24 caracteres (grupos de 6 separados por guiones, sin caracteres ambiguos) que se imprime una sola vez por la salida estándar y nunca se guarda en claro; la Raíz debe cambiarla en su primer ingreso. Auditoría: `organization.provisioned`. Pendiente: códigos de emergencia (necesitan su propia tabla).
  - A1: `GET /users/managed` (subárbol de quien consulta; la Raíz ve a todos; cualquier estado, con estado y responsable) y `POST /users/:id/suspend | reactivate | deactivate | rank | manager` (204). Solo actúa quien gestiona a la persona; la Raíz nunca se suspende, desactiva, baja de rango ni transfiere (403 `USER.ROOT_PROTECTED` o negación de autorización). Suspender y desactivar cierran todas las sesiones en la misma transacción; desactivar además pasa los subordinados activos al responsable de la persona y revoca las invitaciones pendientes que dejó. Suspender exige estado activa y reactivar exige suspendida; en otro caso, 409 `USER.INVALID_STATE`. Cambiar el rango exige reautenticación reciente, que el nuevo rango sea estrictamente inferior al de su responsable (422 `USER.MANAGER_RANK_INVALID`) y se bloquea si la persona tiene subordinados (409 `USER.HAS_REPORTS`). Transferir exige un nuevo responsable activo, dentro del subárbol de quien actúa (o él mismo) y con más autoridad que la persona (422 `USER.MANAGER_RANK_INVALID`; en otro caso se niega sin revelar el motivo). Permisos: suspender y desactivar, `user.deactivate`; reactivar, `user.update`; rango, `user.change_rank`; transferir, `user.transfer`. Auditoría: `user.suspended`, `user.reactivated`, `user.deactivated` (con el número de subordinados reasignados), `user.rank_changed` (rango anterior y nuevo) y `user.manager_changed`. Web: pestaña de gestión de equipo en Usuarios con acciones por fila (suspender, reactivar, cambiar rango con reautenticación, transferir y desactivar con confirmación).
