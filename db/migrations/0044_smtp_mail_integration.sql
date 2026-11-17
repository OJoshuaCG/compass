-- 0044: servidor SMTP configurable por organización (ADR 0047, enmienda del 2026-11-17; tarea T1 de
-- `odd/tasks/smtp-mail-settings.md`).
--
-- Reutiliza las dos tablas de la 0032, sin tablas nuevas:
--  * `integrations` gana el tipo `smtp_mail`: host, puerto, seguridad, usuario y remitente van en `config`
--    (no secretos). Un solo servidor SMTP activo por organización.
--  * `integration_secrets` gana el campo `smtp_password`: la contraseña SMTP, cifrada por el módulo de
--    criptografía con el mismo contexto (AAD) que el resto de los secretos de integración.
--
-- Qué hace:
--  * Reemplaza los dos CHECK en línea de la 0032 (nombres automáticos de PostgreSQL:
--    `integrations_kind_check` e `integration_secrets_field_check`) por versiones que admiten lo nuevo.
--    Los valores anteriores siguen siendo válidos: ninguna fila existente cambia ni se rechaza.
--  * Agrega la unicidad parcial de un servidor SMTP activo por organización (como la del canal de Telegram):
--    dos servidores activos harían que el correo saliera por uno u otro sin que nadie lo decida.
--
-- Lo que NO hace, a propósito:
--  * No cambia privilegios: `iam_app` ya puede leer, insertar y actualizar ambas tablas, y ninguna permite
--    DELETE (una configuración se archiva y su secreto se reemplaza).
--  * No toca el aislamiento por filas: las políticas `*_tenant_isolation` de la 0032 siguen vigentes.
--  * No toca permisos ni roles: reutiliza `alerts.infra.manage` (solo Raíz).
--  * No mueve datos ni escribe auditoría.

alter table integrations drop constraint integrations_kind_check;
alter table integrations add constraint integrations_kind_check
  check (kind in ('telegram_infra', 'telegram_security', 'sms_pull', 'smtp_mail'));
comment on column integrations.kind is 'telegram_infra = avisos de infraestructura (Raíz); telegram_security = avisos de seguridad; sms_pull = consulta de SMS por API; smtp_mail = servidor SMTP de la organización.';

alter table integration_secrets drop constraint integration_secrets_field_check;
alter table integration_secrets add constraint integration_secrets_field_check
  check (field in ('bot_token', 'api_key', 'smtp_password'));

create unique index integrations_one_active_smtp_mail
  on integrations (organization_id)
  where status = 'active' and kind = 'smtp_mail';
