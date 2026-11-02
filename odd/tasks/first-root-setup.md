# Alta del primer usuario Raíz por enlace único

Objetivo: crear la primera organización y su usuario Raíz desde el navegador con un enlace de un solo uso, sin rol con `BYPASSRLS` ni superusuario. Rama: `main` (sin rama nueva, no se pidió). Estrategia de entrega: `ask-on-risk`. Ejecutor de pruebas: `test-runner` (`~/.claude/scripts/run-tests.sh`). ClickUp: 1dfm34y07zm. Toca rutas protegidas con encargo explícito del usuario (Log L2).

## Specs

- S1. "que solo funcione si no existe el usuario raiz"
- S2. "uso unico de una vez, una vez establecido el usuario `root` ya no vuelve a funcionar esa url"
- S3. "ver si definimos un token en el .env para ese login unico o como se crearia, y donde lo visualizaria el usuario?"
- S4. "Hay que pensar que ya desplegaremos en dokploy y todo estara alli"
- S5 (supuesto, decidido por el agente y comunicado al usuario). El token es la variable `FIRST_SETUP_TOKEN` (32 caracteres o más, que genera quien despliega); sin variable la ruta responde 404; se compara en tiempo constante; el enlace es `<APP_ORIGIN>/setup#token=<valor>` y el token viaja en el fragmento, nunca en la URL que ven el servidor o el proxy.
- S6 (supuesto). Quien abre el enlace elige nombre de la organización, identificador, correo y nombre del Root y su contraseña; la respuesta entrega una sola vez los códigos de emergencia.
- S7 (invariante de la tarea de ClickUp). Auditoría de éxito y de intentos fallidos en la misma transacción; sin superusuario ni `BYPASSRLS`.

## Tasks

- [x] T1 (S1-S2, S5, S7) ADR 0046 y su fila en `docs/adr/README.md`. Ruta: inline. Evidencia: ADR 0046 escrito, sin commit aún.
- [x] T2 (S1-S2, S7) Migración 0028: función `auth.create_first_organization` con `SECURITY DEFINER` y prueba en `db/tests`. Ruta: inline.
- [x] T3 (S1-S3, S5-S7) API: configuración, caso de uso, almacén, controlador, contrato y pruebas. Ruta: inline.
- [x] T4 (S3, S6) Web: página `/setup`, i18n es-MX y en-US, pruebas. Ruta: inline.
- [x] T5 (S3-S4) Documentación: runbook, `deployment.md`, `.env.dokploy.example`, `handoff.md`. Ruta: inline.
- [ ] T6 Revisión ciega (`jd-judge-a`, `jd-judge-b`) sobre alcance congelado y romper la regla a propósito.

## Log

- L1 (2026-11-02, usuario): "Te parece seguir con el login de una sola vez para el usuario superadmin"
- L2 (2026-11-02, usuario): "Adelante Solo definir cosas como, que solo funcione si no existe el usuario raiz, uso unico de una vez, una vez establecido el usuario `root` ya no vuelve a funcionar esa url ver si definimos un token en el .env para ese login unico o como se crearia, y donde lo visualizaria el usuario? Hay que pensar que ya desplegaremos en dokploy y todo estara alli, que crees conveniente llevar a cabo? Con esto dicho, planea de nuevo si crees necesario, e inmediatamente puedes llevar a cabo la tarea, sin problema."
- Hallazgo de exploración: solo `organizations` impide el insert a `iam_app` (sin política ni grant de INSERT); `roles`, `users`, `user_passwords`, `user_roles`, `user_recovery_codes` y `audit_events` aceptan el insert con `app.org_id` fijado. Basta una función definer para `organizations`; el resto va en la misma transacción desde la API. Próxima migración 0028, próximo ADR 0046.
- Avance (2026-11-02): T1-T5 hechas en el árbol de trabajo, sin commit. Pruebas dirigidas verdes: db (`first-organization-setup`, `auth-functions`), API (`first-root-setup`, crypto, idempotencia, config), web (`first-setup`, `auth-flows`) y paridad i18n. Lint, tipos y formato de api y web en verde. `node:crypto` quedó solo en el módulo de criptografía: nuevo `CryptoPrimitives.constantTimeEquals`. Pendiente: T6 (jueces ciegos en curso), commits y cierre en ClickUp.
