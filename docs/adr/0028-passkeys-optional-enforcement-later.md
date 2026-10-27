# ADR 0028: Passkeys opcionales para todos; exigirlas queda como configuración futura

- **Estado**: Aceptada
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) ("Autenticación del propio sistema", "Factores"); [ADR 0015](0015-mandatory-mfa-passkeys-preferred.md) (esta decisión resuelve su política pendiente sin reemplazarla); [`docs/backend.md`](../backend.md) §3.6; [`docs/business/authentication.md`](../business/authentication.md) §3.

## Contexto

El ADR 0015 dejó como decisión pendiente del equipo si se exige passkeys a la Raíz y a los Administradores. El plan lo recomienda. Para exigirlas hace falta una configuración por organización, y todavía no existe una pantalla de configuración. Un registro forzado sin alternativa podría dejar a las personas fuera si su dispositivo no soporta WebAuthn.

## Decisión

Las passkeys son **opcionales para todos** y una alternativa completa al código de la aplicación autenticadora al iniciar sesión (resistente al phishing). Cada persona puede tener varias, hasta 10, con nombre. Se exige verificación de usuario y no se pide atestación.

- El alta inicial de una persona registra la aplicación autenticadora; las passkeys se agregan después desde la pantalla de seguridad, con la sesión completa y una reautenticación reciente. Quitar una exige lo mismo.
- La reautenticación de 5 minutos sigue aceptando solo el código de la aplicación.
- El identificador de la parte confiable y el origen salen de `APP_ORIGIN`. WebAuthn necesita un dominio, no una dirección IP; la pila e2e corre en `localhost`.
- Exigir passkeys a la Raíz y a los Administradores será una configuración futura de la organización, cuando exista la pantalla de configuración.

## Alternativas consideradas

- **Exigirlas ya a la Raíz y a los Administradores** (recomendación del plan): descartada por ahora; sin configuración ni alternativa, un dispositivo sin soporte dejaría fuera a la persona.
- **Solo TOTP** _(inferida del plan)_: no resiste phishing; se conserva como alternativa, no como único método.

## Consecuencias

- **Positivas**: quien lo desee tiene un factor resistente al phishing sin bloquear a nadie; el modelo permite activar la exigencia después sin migrar datos.
- **Negativas o costos**: mientras una persona use TOTP, el riesgo de phishing sobre ese factor sigue; la reautenticación con passkey no está disponible; quien deba usar passkeys necesita un dominio propio.
- **Verificación**: ceremonias en el servidor con un autenticador de software y una ceremonia real en Chrome con el autenticador virtual; revisión de dos jueces ciegos (hallazgos corregidos).
