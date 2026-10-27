# ADR 0019: Broker tipo Cerby: puertos e interfaces desde la fase 1, implementación al final

- **Estado**: Aceptada
- **Fecha**: 2026-10-26
- **Referencias**: [`plan.md`](../../plan.md) sección "Fase final: broker de sesiones (tipo Cerby)" y "Lo que se deja preparado desde la fase 1".

## Contexto

El objetivo del broker es que un usuario con nivel USE inicie sesión en una plataforma sin ver la contraseña. Es lo más complejo y frágil del producto: las plataformas cambian, tienen protecciones anti-bot y pueden bloquear por cambio de dispositivo o IP.

## Decisión

Se prepara sin construirlo. Desde la fase 1 existen:

1. El nivel USE ya excluye revelar.
2. `SecretAccessPurpose = REVEAL | TOTP_CODE | EXPORT | INJECT` (con `INJECT` deshabilitado): toda lectura declara su propósito y se audita por propósito.
3. Puertos sin adaptador: `LoginStrategyPort`, `SessionBrokerPort` y `PasswordRotationPort`.
4. Catálogo con `login_strategy` (esquema JSON versionado validado con Zod, vacío en fase 1).
5. Tablas reservadas `login_intents` y `broker_sessions`.
6. Tipo de sesión `device` contemplado en `identity`.
7. Acciones de auditoría reservadas: `credential.injected`, `broker.session.started`, `credential.rotated_by_system`.

La implementación (extensión de navegador o navegador en el servidor) queda para las fases 6 y 7, al final y como opcional con monitoreo por plataforma.

## Alternativas consideradas

- **Construir el broker desde el inicio**: descartado por fragilidad y alcance.
- **No preparar nada** _(inferida del plan)_: descartado porque retrofitear propósitos de acceso y nombres de tablas sería caro; los puertos y el enum cuestan poco hoy.

## Consecuencias

- **Positivas**: el modelo de permisos soporta "usar sin ver" desde el inicio; el broker se agrega sin cambios incompatibles.
- **Negativas o costos**: código y tablas reservados sin uso inmediato. Limitación honesta del enfoque de extensión: un usuario decidido puede leer lo que la extensión inyecta; protege contra exposición casual, no contra un usuario malicioso con acceso.
- **Verificación**: pruebas de que `INJECT` está deshabilitado y de que USE nunca revela la contraseña.
