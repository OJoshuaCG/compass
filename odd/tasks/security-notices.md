# Avisos de seguridad a la dueña de la cuenta (G5)

Trabajo sobre rutas protegidas (identidad), encargado de forma explícita por el dueño el 2026-10-29. La opción A fue **decidida por unanimidad del panel de dos jueces** (`jd-judge-a` y `jd-judge-b`).

## Especificaciones (lo pedido)

Avisos de seguridad por correo a la persona dueña de la cuenta, uno por evento, breves, **sin** códigos, tokens, direcciones de red completas ni enlaces con token; solo fecha y tipo de evento y, si es seguro, un texto que invite a contactar a la administración:

1. Inicio de sesión desde un dispositivo nuevo.
2. Baja (eliminación) del factor de aplicación TOTP de la cuenta de acceso.
3. Regeneración de los códigos de recuperación.

Si un evento no existe todavía como flujo, no se inventa una regla de negocio: se omite y se documenta con su motivo.

## Hallazgos al localizar los eventos

- Ya existían avisos a la persona (código de recuperación usado, llave de acceso agregada o quitada), enviados después del _commit_ con mejor esfuerzo (`sendSecurityNotice`). Se **amplió** `SecurityNoticeKind` en lugar de duplicar el renderizador y el método del puerto `Mailer`.
- (2) Baja del TOTP: el único flujo del sistema que la produce es el restablecimiento con código de emergencia de la Raíz (`SecondFactor.consumeRecoveryCode`, rama de emergencia). No hay una acción de usuario «quitar mi app de autenticación». El comando operativo `recover-root` (provisión) también revoca el TOTP, pero es un proceso de operaciones sin acceso a la bandeja de salida ni al directorio; queda fuera (ver «Omitido»).
- (3) Regeneración de códigos: `replaceRecoveryCodes` solo se llama al confirmar el alta del 2FA, y ese alta se rechaza si ya hay un factor verificado. No existe una acción de «regenerar»; la emisión inicial no es una regeneración.
- (1) Dispositivo nuevo: las sesiones guardan `ip` y `user_agent` solo para listarlas; no existe el concepto de «dispositivo conocido» ni una regla de cuándo uno es nuevo.

## Decisiones de diseño

- El aviso de baja del TOTP sale por el **outbox** (ADR 0035): evento `user.security_notice`, escrito en la misma transacción que la revocación, con solo `userId`, `kind` y `occurredAt`. Si la transacción revierte, no queda evento.
- Se avisa solo si la persona tenía un TOTP **verificado** antes de revocar (quien solo tenía llaves de acceso no pierde ninguna app). Se consulta antes de revocar.
- Manejador `NotifySecurityNotice` (módulo `identity`): resuelve correo e idioma al enviar, acuse por destinataria (`identity.security-notice:<id>`), omite sin fallar si la persona no existe o está dada de baja, falla para reintentar si el correo no sale, contenido inválido con `retryable = false`.
- Renderizador: se agregó `totp_removed` a `renderSecurityNoticeEmail` (es-MX y en-US); mismo texto de cierre que los demás avisos, que invita a cambiar la contraseña y avisar a un Administrador. Sin enlaces ni secretos.
- Se agrega un solo tipo de evento genérico con lista de tipos permitidos (`OUTBOX_SECURITY_NOTICE_KINDS`) para que un aviso futuro (p. ej. dispositivo nuevo) reutilice cola, manejador y acuse.
- Auditoría: sin cambios. `auth.emergency_code_used` ya cubre la acción; el aviso es un efecto, no una acción sensible nueva.
- Sin migración nueva ni dependencias nuevas.

## Omitido (y por qué)

- **Dispositivo nuevo**: no hay concepto de dispositivo ni regla de negocio que lo defina (qué lo identifica, cuánto se recuerda, qué pasa con cookies borradas). Inventarla sería decidir negocio sin encargo. Pendiente de decisión del dueño; cuando exista, usa `OUTBOX_SECURITY_NOTICE_KINDS`.
- **Regeneración de códigos de recuperación**: no existe el flujo. Cuando se cree la acción, debe encolar `kind` nuevo en la misma transacción.
- **Baja del TOTP por `recover-root`** (operaciones): proceso fuera de la API, sin outbox; hoy avisa a los Administradores, no a la Raíz. Decisión abierta.

## Tareas

- [x] Ampliar `SecurityNoticeKind` y el renderizador (es-MX y en-US).
- [x] Evento, cola pg, manejador y acuse; registro en el contenedor.
- [x] Encolar en `SecondFactor.consumeRecoveryCode` en la misma transacción.
- [x] Pruebas: renderizador, manejador, dominio del evento e integración con PostgreSQL real (marcada `SENSIBLE`).
- [x] Documentación: negocio, backend, traspaso.
- [x] Aserción en `emergency.e2e.test.ts` de que el restablecimiento con código de emergencia encola el evento (escrita, sin ejecutar).
- [ ] Revisión humana de las pruebas marcadas `SENSIBLE`.
- [ ] Mutación deliberada (quitar el `enqueue` de `consumeRecoveryCode`) y comprobar que falla la aserción e2e; pendiente porque no se ha ejecutado ninguna prueba.

## Bitácora

- 2026-10-29: implementado el aviso de baja del TOTP por outbox; omitidos dispositivo nuevo y regeneración de códigos por no existir el flujo. Pruebas escritas sin ejecutar: renderizador, manejador, dominio del evento e integración. Formato, tipos y lint de `@iam/api` verificados; ninguna prueba se corrió.
