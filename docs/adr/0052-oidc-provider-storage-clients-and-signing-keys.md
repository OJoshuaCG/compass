# ADR 0052: Almacenamiento, clientes y claves de firma del proveedor OIDC

- **Estado**: Aceptada por la persona dueña del proyecto el 2026-11-18 («proceder con las decisiones recomendadas»: 1A, 2A, 3A y 4A). Sin implementar.
- **Fecha**: 2026-11-18
- **Referencias**: [ADR 0006](0006-multitenancy-ready-rls.md); [ADR 0018](0018-sso-provider-oidc-provider-and-samlify.md); [ADR 0021](0021-pre-authentication-access-with-rls.md); [ADR 0050](0050-sso-libraries-evidence-and-saml-conditions.md); [ADR 0051](0051-single-session-across-sso-protocols.md); [`odd/tasks/phase-2-oidc-sso.md`](../../odd/tasks/phase-2-oidc-sso.md).

## Contexto

Los ADR 0050 y 0051 fijan qué librería se usa y que la sesión de Compass es la única raíz. Faltaba decidir cuatro cosas de la fase 2: quién registra a las aplicaciones cliente, dónde viven las claves con que se firman los tokens, quién puede entrar a cada aplicación y si hay pantalla de consentimiento. Además, `oidc-provider` pide un adaptador de almacenamiento y sus llamadas llegan **antes** de que se conozca la organización (por ejemplo, un cliente que canjea un código en el punto de token), mientras que la regla del proyecto exige acceso a datos siempre con aislamiento por filas.

El spike del ADR 0050 comprobó el comportamiento del paquete con un adaptador en memoria; nada de lo de abajo está probado con PostgreSQL.

## Decisión

1. **Clientes (1A).** Solo la Raíz registra clientes OIDC, por API. La pantalla de administración queda para una tarea posterior. El secreto del cliente se muestra una sola vez al crearlo y se guarda cifrado con el módulo de criptografía (el paquete necesita el valor en claro para comparar, así que un hash no sirve).
2. **Claves de firma (2A).** Un emisor único (`APP_ORIGIN`) con claves de firma en una tabla de plataforma, `oidc_signing_keys`, **sin organización**: es la única excepción a la regla «toda tabla lleva organización», porque el emisor es uno solo. Las claves privadas se guardan cifradas con la clave de plataforma (KMS), nunca en claro ni en el repositorio. Solo se alcanzan mediante funciones de base de datos acotadas, sin `GRANT` directo a `iam_app`. Se admiten varias claves activas a la vez para poder rotar sin cortar a nadie.
3. **Acceso por cliente (3A).** Pueden entrar las personas activas de la **organización dueña del cliente**, nunca de otra. Cada cliente tiene un rango máximo numérico opcional (`max_rank`, de 0 Raíz a 3 Operador: entra quien tiene ese rango o uno de mayor autoridad), y la comprobación se hace en la interacción de login, con el motor de autorización del módulo de acceso, no en el controlador.
4. **Consentimiento (4A).** Sin pantalla para clientes internos; con pantalla solo si el cliente está marcado `is_external`.
5. **Almacenamiento bajo aislamiento por filas.** El adaptador de `oidc-provider` guarda todo en `oidc_payloads`, con `organization_id`, política de aislamiento y sin acceso entre organizaciones. Para conocer la organización antes de la primera llamada, un intermediario resuelve el contexto con **funciones de solo lectura** del esquema `auth` (patrón del ADR 0021, una clave exacta cada una, sin listados): el cliente por `client_id`, o el registro por el hash del identificador (tokens) o por `uid` (interacciones). Resuelta la organización, **todas las escrituras van bajo RLS normal**.
6. **Identificadores protegidos en reposo.** Los identificadores que el paquete trata como secreto (tokens, códigos) se guardan como SHA-256 (`key_hash`); el campo `jti` del contenido se retira al guardar y se reconstruye al leer.
7. **Ligadura a la sesión de Compass.** Cada fila con concesión guarda `compass_session_id` y `user_id`. La fecha de vencimiento de cada fila se recorta a `expires_at` de la sesión (ADR 0051 §4). Revocar una sesión borra las filas ligadas; desactivar o suspender a la persona borra todas las suyas.
8. **Avisos a destinos privados (supuesto, ADR 0050).** El aviso *back-channel* a IP privadas o loopback queda **bloqueado por defecto**; un cliente solo puede recibirlo si lo marca `allow_private_network_backchannel`, y eso lo decide la Raíz al registrarlo.

## Alternativas consideradas

- **Emisor por organización (2B)** _(inferida)_: más fiel a multitenancy, pero multiplica claves, rutas y pruebas y hoy una persona pertenece a una sola organización (ADR 0044). Descartada por ahora.
- **Funciones de escritura previas a la autenticación** _(inferida)_: permitirían guardar sin conocer la organización, pero romperían la regla de que el ADR 0021 solo lee. Descartadas.
- **Pantalla de administración desde el primer día (1B)**: se pospone, no se descarta.
- **Lista de personas por cliente (3B)**: más estricta; se podrá añadir sobre `max_rank` sin rehacer el modelo.
- **Consentimiento siempre (4B)**: más fricción sin ganancia para clientes que la propia Raíz registró.

## Consecuencias

- **Positivas**: una sola tabla de almacenamiento aislada por organización; la cascada de revocación del ADR 0051 es un `delete` por sesión o por persona; las claves de firma nunca salen cifradas del módulo de criptografía.
- **Negativas o costos**: `oidc_signing_keys` rompe la regla de organización por diseño y necesita su propia prueba de acceso; el intermediario de contexto es código nuevo en una ruta protegida; el recorte de vencimiento y el hash de identificadores son lógica propia sobre el paquete que debe probarse contra PostgreSQL.
- **Seguridad**: toca identidad, criptografía, migraciones con aislamiento y cabeceras (rutas protegidas). Exige revisión adversarial con dos jueces ciegos y que una persona revise las pruebas de autorización, aislamiento y criptografía.
- **Verificación**: pruebas de RLS entre dos organizaciones para `oidc_clients` y `oidc_payloads`; la función de lectura de organización no lista ni acepta patrones; `iam_app` no puede leer `oidc_signing_keys` directamente; una concesión de otra organización no se lee ni se revoca por error; desactivar a la persona borra todas sus filas; prueba de rotura deliberada quitando la política de aislamiento.
