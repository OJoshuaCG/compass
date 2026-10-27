# ADR 0030: Desafíos de WebAuthn ligados a la sesión

- **Estado**: Aceptada
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) ("Autenticación del propio sistema", passkeys); [`docs/database.md`](../database.md) §5.1 (`webauthn_challenges`); [ADR 0028](0028-passkeys-optional-enforcement-later.md).

## Contexto

Una ceremonia de WebAuthn (registrar una passkey o ingresar con ella) firma un desafío que el servidor emitió antes. Si el desafío solo estuviera ligado a la persona y al propósito, otra sesión de la misma persona (por ejemplo, una abierta en otro dispositivo) podría consumirlo o gastarlo, y varios desafíos vigentes a la vez ampliarían la superficie de reutilización.

## Decisión

Cada desafío es aleatorio, de un solo uso y de 5 minutos, y queda ligado a tres cosas: la persona, el propósito (registro o ingreso) y la **sesión** que lo pidió. Solo hay uno vigente por sesión y propósito: una petición nueva de la misma sesión reemplaza al pendiente, y otra sesión no puede gastarlo. Vive en una tabla efímera con aislamiento por organización (migración 0011).

Reglas que lo acompañan: el contador de firmas debe avanzar; los fallos comparten el límite de intentos de la persona y pedir el desafío no cuenta como intento; las ceremonias fallidas se auditan; los transportes guardados se limitan a una lista conocida; las respuestas nunca incluyen claves.

## Alternativas consideradas

- **Ligar solo a persona y propósito**: es la versión inicial; la revisión ciega mostró que otra sesión de la misma persona podía interferir. Descartada.
- **Guardar el desafío en memoria de la instancia o en una cookie** _(inferida del plan)_: no sirve con más de una instancia y complica la rotación de la clave de la cookie.

## Consecuencias

- **Positivas**: el desafío emitido para una ceremonia no valida otra ni otra sesión; un solo desafío vigente limita la reutilización.
- **Negativas o costos**: los desafíos vencidos todavía no se purgan (necesita el mismo trabajo de limpieza que la idempotencia); las opciones de ingreso devuelven los identificadores de las credenciales de quien ya verificó la contraseña.
- **Verificación**: pruebas de integración de ceremonias con un autenticador de software, prueba de aislamiento por organización y revisión de dos jueces ciegos (hallazgos corregidos).
