# ADR 0033: Reautenticación con TOTP o passkey

- **Estado**: Aceptada (2026-10-27). La implementación queda pendiente (tarea G3)
- **Fecha**: 2026-10-27
- **Referencias**: [ADR 0028](0028-passkeys-optional-enforcement-later.md); [ADR 0027](0027-emergency-codes-root-reset-model.md); `apps/api/src/modules/identity/` (`second-factor.ts`, `reauthenticate`).

## Contexto

Las acciones sensibles piden reautenticar. Hoy `reauthenticate` acepta solo un código TOTP. Quien usa passkey sin TOTP queda sin camino, y el código de recuperación no debe servir para esto.

## Decisión

1. La reautenticación acepta **TOTP o passkey** (verificación de usuario WebAuthn), a elección de la persona.
2. **Nunca** se acepta un código de recuperación o de emergencia para reautenticar: son para recuperar acceso, no para confirmar acciones.
3. Esta decisión **amplía** el ADR 0028 sin reemplazarlo.

## Alternativas

- **Solo TOTP** (estado actual): descartada; excluye a quienes solo tienen passkey.
- **Aceptar códigos de recuperación**: descartada; debilita el factor que protege las acciones más sensibles.

## Consecuencias

- **Positivas**: coherencia con el modelo de passkeys opcionales.
- **Negativas**: dos rutas de verificación que probar; el desafío WebAuthn debe ir ligado a la sesión (ADR 0030).
- **Pendiente**: implementar en G3 (ruta protegida: encargo humano) con matriz de autorización.
