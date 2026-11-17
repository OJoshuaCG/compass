# ADR 0050: Evidencia sobre `oidc-provider` y `samlify` y condiciones para usar SAML

- **Estado**: Propuesta (pendiente de la ratificación de la persona dueña). Complementa al [ADR 0018](0018-sso-provider-oidc-provider-and-samlify.md), que sigue vigente y no se reemplaza.
- **Fecha**: 2026-11-17
- **Referencias**: [ADR 0018](0018-sso-provider-oidc-provider-and-samlify.md); [`plan.md`](../../plan.md) secciones «Seguridad (no se reimplementan)» y «Hoja de ruta SSO y preparación del broker tipo Cerby»; [`docs/backend.md`](../backend.md) §16 (spike de `oidc-provider` sobre Fastify).

## Resumen

Se confirma `oidc-provider` para la fase 2. Para la fase 3 se mantiene `samlify` como opción, pero **condicionada**: antes de escribir código SAML se confirma la elegibilidad con Meta y se compara contra un puente (Keycloak). Ambas bibliotecas conviven sin excluirse.

## Contexto

Hechos verificados por búsqueda web el 2026-11-17. Varias fuentes son blogs o agregadores; los datos de seguridad salen de los avisos publicados (GitLab Advisory Database, GitHub Advisories). **No se pudo confirmar** la versión vigente de ninguna biblioteca desde su repositorio oficial, y eso debe revisarse al adoptarlas.

- **`oidc-provider`** (autor: panva, el mismo de `jose`, que el plan ya usa): certificado OpenID en varios perfiles (Basic, Implicit, Hybrid, Config, Dynamic, Form Post). Snyk lo marcaba con mantenimiento sano y sin vulnerabilidades conocidas (última versión vista: 9.8.3, sin fecha confirmada). Tiene un solo mantenedor. Desde la v8 se niega a arrancar si no se reconoce un cambio incompatible.
- **`samlify`**: CVE-2025-47949, falla crítica de *signature wrapping* (CVSS 4.0 de 9.9 según el CCB belga) que permite falsificar una respuesta SAML y entrar como otra persona; afecta a versiones anteriores a 2.10.0. Antes hubo CVE-2017-1000452 (corregido en 2.3.0): el mismo tipo de falla dos veces.
- **El resto del ecosistema Node para SAML tuvo fallas parecidas en 2025:** `@node-saml/node-saml` (CVE-2025-54369 y CVE-2025-54419, corregidas en 5.1.0) y `xml-crypto` (CVE-2025-29774 y CVE-2025-29775). Además `@node-saml/node-saml` es sobre todo cliente (SP), no IdP.
- **Meta no publica criterios de elegibilidad claros** para las cuentas administradas con SSO. Su documentación dice que la elegibilidad es por organización y depende de poder operar SSO o aprovisionamiento con un proveedor de identidad; un proveedor externo afirma que la función se ofrece solo a clientes seleccionados. Las guías de configuración que existen son de terceros (Okta, Microsoft Entra, Cerby) y describen SAML para el inicio de sesión y SCIM para el aprovisionamiento.

## Decisión

1. **Fase 2: `oidc-provider`, sin cambios respecto al ADR 0018.** Corre dentro del proceso de la API y las pantallas de login, MFA y consentimiento reutilizan el módulo de identidad, así que se conservan el aislamiento por filas y la auditoría en la misma transacción. La versión se fija exacta y se respeta la espera de 7 días del proyecto.
2. **Las dos bibliotecas no son excluyentes.** Hablan protocolos distintos (OIDC con JWT, SAML con XML) y comparten una sola identidad: mismo login y MFA, mismo directorio y permisos, misma auditoría y misma revocación. Debe existir **una sola sesión** de Compass que sirva a ambos protocolos, y desactivar a una persona debe cerrarla en los dos.
3. **Fase 3: `samlify` solo si se cumplen estas condiciones.**
   - Antes de escribir código SAML se confirma la elegibilidad de la organización con Meta (ver «Verificación»). Si no es elegible, la fase 3 pierde su objetivo principal y no se construye SAML.
   - Si se construye dentro de Compass, la versión mínima es `samlify` 2.10.0, con el validador XML endurecido que ya prevé el plan, una revisión externa dedicada y cobertura en la prueba de penetración.
   - Antes de comprometerse se evalúa el puente: Keycloak (u otro proveedor SAML maduro) usando a Compass como su proveedor OIDC de origen, de modo que la validación y emisión de SAML quede en un componente con equipo de seguridad propio.
4. **No se adopta un proveedor de identidad completo (Keycloak, Authentik) como dueño del login**, porque duplicaría personas, MFA y sesiones y rompería la auditoría en la misma transacción.

## Alternativas consideradas

- **Ory Hydra** _(inferida; no está en el plan)_: servidor OAuth2/OIDC aparte que delega el login a Compass. Respeta que Compass sea dueño de la identidad, pero agrega un servicio y una base de datos para operar sin ofrecer algo que `oidc-provider` no dé dentro del proceso. No incluye SAML.
- **Keycloak como dueño de la identidad**: SAML más maduro y federación con directorios, pero es otro sistema de identidad y una JVM que operar. Se descarta como dueño del login; sigue abierto como puente solo para SAML.
- **Authentik**: más liviano que Keycloak, con SAML menos probado según las fuentes. Las fuentes se contradicen sobre si SCIM es gratis o de la edición enterprise (sin confirmar).
- **`@node-saml/node-saml`, `saml2-js`, `passport-saml`, `samlp`** _(inferidas)_: no ofrecen un IdP claramente más seguro; las tres primeras son sobre todo de lado cliente y comparten la base de firma XML con fallas en 2025. No se confirmó el estado de mantenimiento de `samlp`.
- **Implementar OIDC o SAML a la medida**: descartado por el principio rector del plan.
- **Usar el IdP existente de la organización (Google Workspace, Microsoft 365, Okta) para Meta** _(inferida)_: las integraciones con Meta ya existen y están publicadas; evitaría construir SAML y SCIM. Depende de qué IdP use la organización, dato que este ADR no tiene.

## Consecuencias

- **Positivas**: OIDC avanza sin cambios. El riesgo de SAML queda acotado por condiciones explícitas en lugar de asumirse; se puede ahorrar toda la superficie de ataque SAML si Meta no es elegible.
- **Negativas o costos**: `oidc-provider` depende de un solo mantenedor y cada versión mayor exige revisar cambios incompatibles; está basado en Koa y sigue pendiente el spike sobre Fastify del ADR 0018. Un puente con Keycloak agrega un servicio Java por operar. Una sesión única para OIDC y SAML la construye Compass; ninguna biblioteca la resuelve.
- **Verificación**:
  - Elegibilidad con Meta: comprobar si el Admin Center del Business Portfolio muestra la opción de conectar un proveedor de identidad, verificar el dominio de correo y preguntar por escrito a Meta si el portfolio es elegible para cuentas administradas con SSO SAML y aprovisionamiento SCIM.
  - Confirmar versión vigente, licencia y mantenimiento de ambas bibliotecas en su repositorio oficial y en npm antes de adoptarlas.
  - Pentest externo antes de cada fase de SSO (ya exigido); pruebas de cierre de sesión coordinado y de revocación al desactivar personas.
  - Si se usa `samlify`: prueba de regresión que rechace una aserción con firma envuelta y una versión menor a 2.10.0 bloqueada por la configuración de dependencias.

## Fuentes

- CVE-2025-47949 `samlify`: https://advisories.gitlab.com/npm/samlify/CVE-2025-47949/
- Aviso del CCB de Bélgica: https://ccb.belgium.be/advisories/warning-critical-signature-wrapping-vulnerability-samlify-library-saml-single-sign-patch
- CVE-2017-1000452 `samlify`: https://advisories.gitlab.com/pkg/npm/samlify/CVE-2017-1000452
- CVE-2025-54369 `node-saml`: https://advisories.gitlab.com/npm/node-saml/CVE-2025-54369/
- CVE-2025-54419 `@node-saml/node-saml`: https://advisories.gitlab.com/npm/@node-saml/node-saml/CVE-2025-54419/
- CVE-2025-29774 `xml-crypto`: https://advisories.gitlab.com/npm/xml-crypto/CVE-2025-29774/
- `oidc-provider` en Snyk: https://security.snyk.io/package/npm/oidc-provider
- Preguntas frecuentes de cuentas administradas de Meta: https://developers.facebook.com/documentation/facebook-login/managed-accounts/faq
- Ory Hydra, concepto de login: https://www.ory.com/hydra/docs/concepts/login
