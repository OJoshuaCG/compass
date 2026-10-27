# ADR 0018: Proveedor SSO con `oidc-provider` (fase 2) y SAML (fase 3)

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Hoja de ruta SSO y preparación del broker tipo Cerby"; [`docs/backend.md`](../backend.md) §16 (spike de `oidc-provider` sobre Fastify).

## Contexto

El producto será proveedor SSO: primero OIDC (herramientas internas y SaaS con OIDC), luego SAML con SCIM (objetivo principal: managed Meta accounts, que exige SAML). Un protocolo de identidad mal implementado es un riesgo de seguridad mayor.

## Decisión

- **Fase 2**: `oidc-provider` (certificado OpenID) con adaptadores propios a PostgreSQL y pantallas de login, MFA y consentimiento propias que reutilizan el módulo `identity`. Authorization Code con PKCE obligatorio; sin implicit ni password grant; `redirect_uri` exacto; clientes registrados solo por administradores (`sso.clients.manage`).
- **Fase 3**: SAML IdP con `samlify` y un validador XML endurecido, con revisión de seguridad dedicada; SCIM 2.0 como cliente.

El motor de protocolo es una biblioteca; el resto se construye a la medida.

## Alternativas consideradas

- **Implementar OIDC o SAML a la medida**: descartado por el principio rector del plan (ninguna primitiva de seguridad se reinventa).
- **Postergar el SSO** _(inferida del plan)_: no se descarta el producto, pero las fases 2 y 3 solo se abren al cerrar la anterior.

## Consecuencias

- **Positivas**: motor certificado; cada paso reutiliza identidad, permisos y auditoría.
- **Negativas o costos**: `oidc-provider` está basado en Koa y debe validarse sobre Fastify con un spike antes de comprometerse; las implementaciones SAML tienen historial de fallas de validación de firmas XML y entidades externas. Hay que confirmar la elegibilidad para managed Meta accounts antes de la fase 3.
- **Verificación**: pentest antes de cada fase de SSO; pruebas de logout back-channel y de revocación al desactivar usuarios.
