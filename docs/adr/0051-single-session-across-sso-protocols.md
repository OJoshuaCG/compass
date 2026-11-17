# ADR 0051: Una sola sesión de Compass para OIDC y SAML

- **Estado**: Propuesta (pendiente de la ratificación de la persona dueña; las decisiones abiertas D1 a D4 de abajo necesitan su respuesta antes de la fase 2).
- **Fecha**: 2026-11-17
- **Referencias**: [ADR 0018](0018-sso-provider-oidc-provider-and-samlify.md); [ADR 0025](0025-session-time-single-clock-source.md) (reloj único para la sesión); [ADR 0050](0050-sso-libraries-evidence-and-saml-conditions.md); [`docs/business/authentication.md`](../business/authentication.md) §4 (sesiones); [`docs/database.md`](../database.md) (`sessions`, §9.2 `oidc_grants`); [`docs/backend.md`](../backend.md) (guard de sesión); [`plan.md`](../../plan.md) (reautenticación y fase 2).

## Resumen

Cuando Compass sea proveedor de inicio de sesión único (OIDC en la fase 2, SAML en la 3) habrá tres cosas que pueden «seguir abiertas»: la sesión de Compass, las concesiones OIDC y las aserciones SAML. Este ADR propone que **la sesión de Compass sea la única raíz**: nada emitido por SSO vive más que ella ni sobrevive a su cierre.

## Contexto

Hechos tomados de la documentación vigente del proyecto (no se probó nada nuevo para este ADR):

- Las sesiones están en la tabla `sessions`: se identifican por el hash del token (`token_hash`), con `mfa_at`, `reauth_at`, `last_seen_at`, `expires_at` y `revoked_at`. Una sesión está viva si no está revocada, no venció (absoluta, 12 horas) y tuvo actividad en los últimos 30 minutos. El token viaja solo en la cookie.
- Las sesiones se cierran al instante: por la persona, por su responsable, al suspender, al desactivar, al cambiar el rango y al cambiar la contraseña inicial de la Raíz. Los tiempos usan una sola fuente de reloj (ADR 0025).
- La reautenticación (step-up) vale 5 minutos y protege las acciones sensibles de Compass.
- `docs/database.md` §9.2 ya reserva `oidc_grants` con `grant_id` (para revocar en cascada ante reuso de un *refresh token*) y anota que al desactivar a una persona se revocan sus concesiones y se dispara *back-channel logout*.

El riesgo que este ADR cierra: si OIDC y SAML mantienen sesiones con vida propia, desactivar a una persona en Compass podría dejarla dentro de las aplicaciones conectadas durante horas o días. Eso anularía justo la promesa de la fase 2 («al desactivar a una persona se cierran sus sesiones en las aplicaciones conectadas») y la de Meta en la fase 3.

**Lo que no está verificado:** cómo exactamente `oidc-provider` mantiene su propia sesión y cómo se liga a la nuestra. Es una de las pruebas del spike (ADR 0050); lo escrito aquí es la intención de diseño, no un comportamiento comprobado del paquete.

## Decisión (propuesta)

1. **La fila de `sessions` es la única fuente de verdad.** Ni `oidc-provider` ni la capa SAML tienen una sesión con vida independiente. Al iniciar sesión en una aplicación conectada se usa la sesión ya abierta en Compass; si no hay una viva, se muestra el login de Compass.
2. **Cada cosa emitida apunta a su sesión.** Las concesiones OIDC (`oidc_grants`) guardan la sesión de Compass de la que nacen, con índice para revocarlas en bloque; las aserciones SAML emitidas dejan un registro mínimo con la misma referencia. A las aplicaciones se les entrega un identificador de sesión **opaco y distinto** del identificador interno y del hash del token (en OIDC, el claim `sid`), para poder pedir el cierre sin exponer nada interno.
3. **Revocación en cascada.** Cuando una sesión de Compass se cierra, vence o se revoca (por cualquiera de los motivos de arriba), se revocan sus concesiones OIDC y se marcan terminadas sus aserciones SAML. Al desactivar o suspender a una persona se revocan además **todas** sus concesiones por persona, haya o no sesión viva, porque un *refresh token* no depende de que haya una pestaña abierta. La revocación en base de datos va en la misma transacción que la auditoría; el aviso por red a las aplicaciones (*back-channel logout* de OIDC) sale por el *outbox* con reintentos, porque no puede ir dentro de la transacción.
4. **Ninguna vida emitida excede la de la sesión.** El *access token* es de vida corta (valor en D2). Un *refresh token* solo se entrega si la política del cliente lo pide, rota en cada uso, y su refresco comprueba que la sesión de Compass siga viva. La aserción SAML lleva `SessionNotOnOrAfter` menor o igual que `expires_at` de la sesión.
5. **La autenticación se informa con la verdad de Compass.** En OIDC, `auth_time` sale de `mfa_at`, y `acr` y `amr` reflejan que hubo segundo factor; se respetan `prompt=login` y `max_age` forzando una reautenticación real (nunca se reutiliza la sesión para saltarlos). En SAML, `AuthnInstant` sale de `mfa_at` y el contexto de autenticación declara el segundo factor. La reautenticación de 5 minutos de las acciones de Compass **no** se hereda a las aplicaciones.
6. **Cada concesión va ligada a una organización** y el adaptador a PostgreSQL pasa por el contexto de organización con aislamiento por filas, como cualquier otra tabla (regla de seguridad del proyecto).
7. **Las sesiones de dispositivo (fase 6) y del broker (fase 7) no emiten SSO.** Solo una sesión web con segundo factor puede originar concesiones.
8. **El cierre único en SAML tiene límite.** El cierre de sesión único de SAML tiene soporte irregular entre proveedores. Se asume _(sin verificar)_ que Meta no lo ofrece; si es así, la baja efectiva en Meta depende de SCIM (desaprovisionar) y de la vida corta de las aserciones. Este límite se documenta de cara a la persona dueña, sin prometer un cierre inmediato donde no se puede garantizar.

## Decisiones abiertas para la persona dueña

Cada una trae mi recomendación; hasta que se responda, el diseño usa el valor recomendado y se marca como supuesto.

- **D1. ¿Usar una aplicación conectada mantiene viva la sesión de Compass?** Hoy la sesión vence tras 30 minutos sin actividad. Si trabajar en Grafana no cuenta como actividad, la sesión de Compass vence mientras la persona sigue trabajando y las aplicaciones pierden el acceso a mitad del día. _Recomendación:_ que el uso (refrescar un token, abrir sesión en una app) cuente como actividad, **manteniendo** el tope absoluto de 12 horas. Se gana comodidad; se pierde algo de rigor (un token robado mantendría viva la sesión hasta el tope).
- **D2. Vida del *access token*.** _Recomendación:_ 5 minutos. Cuanto más corta, más rápido se nota una baja aunque falle el aviso por red; cuanto más larga, menos viajes de refresco.
- **D3. ¿Se permiten *refresh tokens*?** _Recomendación:_ solo a los clientes que lo justifiquen por escrito, con vida máxima igual al tope absoluto de la sesión. Sin ellos, la persona tendría que volver a pasar por Compass cada 5 minutos (que, con la sesión viva, es transparente).
- **D4. ¿Qué se promete de la baja en Meta?** Si Meta no ofrece cierre único, la promesa honesta es «se desaprovisiona por SCIM y la aserción vence pronto», no «se cierra al instante». _Recomendación:_ escribirlo así en la documentación de negocio.

## Alternativas consideradas

- **Dejar que `oidc-provider` y la capa SAML lleven su propia sesión con vida independiente** _(inferida del plan)_: es lo más simple de empezar, pero crea dos relojes, contradice la fuente única de tiempo del ADR 0025 y deja a una persona desactivada dentro de las aplicaciones hasta que venza la sesión ajena. Descartada.
- **Tokens de larga vida sin consultar a Compass** _(inferida)_: menos carga, pero la baja no sería efectiva. Descartada.
- **Consultar a Compass en cada petición de las aplicaciones (introspección)** _(inferida)_: baja inmediata, pero convierte a Compass en punto único de falla de todas las aplicaciones y exige que cada una implemente la consulta. Se deja para clientes que lo pidan; la regla general son tokens cortos más revocación.
- **Un proveedor de identidad externo que lleve las sesiones** (Keycloak, Authentik): descartado en el [ADR 0050](0050-sso-libraries-evidence-and-saml-conditions.md) como dueño del login; rompería la auditoría en la misma transacción.

## Consecuencias

- **Positivas**: una sola respuesta a «¿esta persona sigue dentro?»; desactivar cierra todo en cascada y queda auditado; el diseño sirve igual a OIDC y a SAML y a futuros protocolos.
- **Negativas o costos**: hay que ligar la sesión de `oidc-provider` a la nuestra, con un adaptador propio que el spike debe validar; el aviso a las aplicaciones depende de la red y de que cada cliente implemente *back-channel logout*, por eso las vidas cortas son parte de la decisión y no un detalle; D1 cambia la semántica de la inactividad y debe quedar documentada en `docs/business/authentication.md` cuando se acepte.
- **Seguridad**: toca rutas protegidas (identidad, acceso, sesiones y auditoría). Este ADR es solo documentación; su implementación necesita encargo humano explícito, revisión adversarial con dos jueces ciegos sobre el mismo alcance congelado y que una persona revise las pruebas de autorización, aislamiento y sesión.
- **Verificación** (pruebas que deben existir antes de aceptar la fase 2):
  - Desactivar o suspender a una persona revoca sus concesiones y dispara el aviso de cierre aunque no tenga sesión viva.
  - Cerrar la sesión de Compass (propia, por el responsable, por cambio de rango) revoca las concesiones ligadas; las de otras sesiones de la misma persona no se tocan.
  - Un *refresh token* usado después de cerrar la sesión falla, y reusar uno ya rotado revoca toda la concesión.
  - Ningún token ni aserción vive más que `expires_at` de su sesión (prueba con reloj controlado).
  - `prompt=login` y `max_age` fuerzan una reautenticación real.
  - Una concesión de otra organización no se lee ni se revoca por error (aislamiento).
  - Prueba de rotura deliberada: quitar la comprobación de sesión viva en el refresco hace fallar alguna prueba.
