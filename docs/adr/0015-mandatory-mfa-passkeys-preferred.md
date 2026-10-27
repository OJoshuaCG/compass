# ADR 0015: MFA obligatorio; passkeys como método preferido

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) secciones "Autenticación del propio sistema", "Factores" y "Reautenticación (step-up)".

## Contexto

El sistema guarda el 2FA de toda la organización, así que su propio login debe ser el más fuerte de todos. El phishing es la amenaza principal contra credenciales de empleados.

## Decisión

MFA obligatorio desde la primera sesión: el invitado define su contraseña y registra un segundo factor (passkey o TOTP) antes de entrar. Passkeys (WebAuthn, `@simplewebauthn/server`) son el método preferido por su resistencia al phishing; TOTP es la alternativa; los códigos de recuperación son el último recurso. Sin SMS ni correo como segundo factor del propio sistema. La política "exigir passkeys para Raíz y Administradores" es configurable por organización y se recomienda activarla desde el inicio (decisión pendiente del equipo en el plan). Las acciones sensibles exigen reautenticación válida por 5 minutos.

## Alternativas consideradas

- **MFA opcional**: descartado por la criticidad del sistema.
- **SMS o correo como segundo factor** _(prohibido en el plan)_: descartados por ser los factores más débiles (intercambio de SIM, intercepción).
- **Solo TOTP** _(inferida del plan)_: descartado como único método porque no resiste phishing; queda como alternativa.

## Consecuencias

- **Positivas**: resistencia al phishing; recuperación definida y notificada.
- **Negativas o costos**: fricción de alta de usuarios; necesidad de procesos de recuperación (responsable o Raíz, y códigos de emergencia de la Raíz custodiados).
- **Verificación**: prueba de punta a punta de invitación, MFA y login con passkey (criterio de salida de la fase 1a); pruebas de reautenticación.
