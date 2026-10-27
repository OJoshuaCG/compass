# ADR 0027: Códigos de emergencia: solo los custodios restablecen a la Raíz

- **Estado**: Aceptada
- **Fecha**: 2026-10-27
- **Referencias**: [`plan.md`](../../plan.md) ("Autenticación del propio sistema", recuperación de la Raíz); [`docs/business/authentication.md`](../business/authentication.md) §7; [ADR 0007](0007-four-actors.md); [ADR 0015](0015-mandatory-mfa-passkeys-preferred.md); [runbook](../runbooks/use-emergency-code.md).

## Contexto

El plan pide que, al crear la organización, se generen códigos de emergencia impresos y custodiados por dos personas fuera del sistema, y que usarlos alerte a todos los Administradores y quede auditado. No define qué otorga usar uno, en qué se distingue de un código de recuperación ni quién puede restablecer a la Raíz. La Raíz es la cuenta de mayor privilegio: cualquier camino que permita restablecerla es también un camino para tomarla.

## Decisión

Al crear la organización, el comando de operaciones genera ocho códigos de emergencia de un solo uso para la Raíz, con la misma forma que los de recuperación, y los imprime una sola vez junto a la contraseña inicial. Se guardan solo como hash y se distinguen por una columna `kind`.

Usar uno solo es posible después de verificar la contraseña, en el paso de recuperación del ingreso, y:

- restablece el segundo factor de la Raíz: la aplicación autenticadora, las passkeys y los códigos de recuperación ordinarios dejan de servir;
- deja a la Raíz con el registro del segundo factor pendiente, incluida la sesión que lo usó, y cierra sus demás sesiones;
- escribe el evento crítico `auth.emergency_code_used` y avisa por correo a cada Administrador activo después del *commit*; si el correo falla o no hay destinatarios, audita `auth.emergency_alert_incomplete`;
- no sustituye la contraseña, deja vigentes los códigos de emergencia sin usar y, al registrar un segundo factor nuevo, reemite solo los códigos de recuperación ordinarios.

**Decisión del dueño (2026-10-27):** solo las personas que custodian los códigos pueden restablecer a la Raíz. Ningún Administrador puede hacerlo; solo recibe la alerta.

## Alternativas consideradas

- **Que un Administrador (o dos) pueda restablecer a la Raíz**: descartada por el dueño. Convertiría a un Administrador comprometido en un camino para tomar la cuenta de mayor privilegio.
- **Que el código sustituya a la contraseña** _(inferida del plan)_: descartada. Un papel robado bastaría para entrar como Raíz; con la contraseña exigida hacen falta dos cosas distintas.
- **Un código de emergencia que solo alerta y no restablece nada** _(inferida del plan)_: no resuelve el problema (la Raíz sin segundo factor no puede entrar).

## Consecuencias

- **Positivas**: la organización no queda sin dueña si la Raíz pierde su segundo factor; ningún rango inferior puede tomar la Raíz; el uso es visible y queda como evento crítico.
- **Negativas o costos**: olvidar la contraseña y perder los factores sigue sin recuperación en el sistema; quien tenga un código y la contraseña puede restablecer el factor de la Raíz; la alerta depende del correo; no hay forma de emitir códigos nuevos tras agotarlos (pendiente); la identidad de los dos custodios sigue como decisión del equipo.
- **Verificación**: pruebas de integración contra PostgreSQL real del uso, de la sesión degradada, de la revocación de passkeys y de la alerta; revisión de dos jueces ciegos sobre el alcance (hallazgos corregidos).
