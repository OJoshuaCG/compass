# ADR 0014: Sesiones de servidor con cookie, no JWT, para la propia app

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Sesiones" y "Seguridad en el navegador"; [`docs/backend.md`](../backend.md) §7.2.

## Contexto

La aplicación protege el 2FA de toda la organización y debe poder revocar el acceso de inmediato (desactivar, suspender, cambiar rango o roles). Además, la web y la API comparten origen, así que no hace falta un token portable.

## Decisión

Token de sesión opaco de 256 bits en la cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`); en base de datos solo su SHA-256. Expiración por inactividad de 30 minutos y absoluta de 12 horas (configurables por organización). Sin CORS abierto ni tokens en `localStorage`. CSRF: `SameSite` más cabecera `X-Requested-With` en peticiones que modifican y verificación de `Origin`. JWT (`jose`) queda reservado para el proveedor SSO de fases futuras, no para la sesión de la propia app.

## Alternativas consideradas

- **JWT de sesión**: descartado porque la revocación inmediata exige estado en el servidor y el token viviría en el navegador.
- **Tokens en `localStorage`**: descartado por la regla de no guardar secretos ni tokens en almacenamiento del navegador.

## Consecuencias

- **Positivas**: revocación inmediata; sin tokens accesibles por JavaScript.
- **Negativas o costos**: cada petición consulta el estado de la sesión (Redis puede servir sesiones calientes); la extensión futura necesitará un tipo de sesión `device` propio.
- **Verificación**: pruebas de revocación al desactivar o cambiar rango; pruebas de atributos de la cookie y de CSRF.
