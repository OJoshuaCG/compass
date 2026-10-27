# ADR 0017: Cinco métodos de registro de 2FA, todos disponibles

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "2FA/TOTP: registro y generación de códigos" (métodos, validación, confirmación y handoff).

## Contexto

Los usuarios migran secretos 2FA desde contextos distintos (escritorio con la plataforma abierta, teléfonos personales, plataformas que ofrecen solo clave manual). Hay un requisito explícito de dar opciones.

## Decisión

Cinco métodos disponibles siempre, que terminan en el mismo caso de uso `RegisterTotpSecret` con la misma validación y confirmación:

1. Captura de pestaña (`getDisplayMedia`), método destacado en la UI.
2. Imagen pegada o subida.
3. Clave manual (Base32 o URI `otpauth://`).
4. Celular (handoff con cámara; token de 256 bits de un solo uso y 5 minutos, y confirmación en el escritorio).
5. Importar (`otpauth-migration://` de Google Authenticator u otros autenticadores).

El QR se decodifica en el cliente y al servidor solo llega la URI por TLS. La confirmación es obligatoria: el secreto pasa a `verified` solo cuando el usuario confirma que la plataforma aceptó el código.

## Alternativas consideradas

- **Un solo método (por ejemplo, clave manual)**: descartado por el requisito de dar opciones.
- **Subir la imagen del QR al servidor** _(inferida del plan)_: descartado; el plan decodifica localmente y nunca sube la imagen.

## Consecuencias

- **Positivas**: cobertura de todos los orígenes de 2FA; un solo camino de validación.
- **Negativas o costos**: más superficie de cliente (captura, cámara, decodificación) y un flujo de handoff con riesgos propios (inyección de un secreto ajeno, mitigada por la confirmación en el escritorio).
- **Verificación**: pruebas de validación de URI y del flujo de confirmación; pruebas de expiración y un solo uso del token de handoff.
