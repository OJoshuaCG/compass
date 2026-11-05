-- 0034: preferencias de alerta de la Raíz (decisión del dueño del 2026-11-04, ADR 0042 y ADR 0047).
--
-- El dueño pidió «Que se pueda configurar la alerta, en un panel "root" para recibir estas alertas con
-- opciones de "Correo y/o Telegram"» y eligió una tabla nueva para guardarlo. Esta tabla guarda, por
-- organización, por qué canales llegan las alertas de infraestructura (`integration.infra_alert`): correo a
-- las cuentas Raíz activas, el chat de Telegram de infraestructura, o ambos.
--
-- Decisiones:
--  * Una fila por organización (la llave primaria ES la organización, y sirve de índice). Sin fila rige el
--    valor por omisión del dominio: correo y Telegram encendidos, que conserva el aviso por Telegram que ya
--    existía y suma el correo (ADR 0047: Telegram complementa el correo, no lo reemplaza).
--  * Al menos un canal encendido: apagar los dos dejaría a la Raíz sin enterarse de que la plataforma falla.
--    El dominio lo valida con un error claro; la base lo impone además, por si el código fallara.
--  * Sin DELETE: el ajuste se cambia, nunca se borra, para que la auditoría apunte a una fila que existe.
--  * Sin secretos: el token del bot vive cifrado en `integration_secrets` (migración 0032).
create table alert_settings (
  organization_id  uuid primary key references organizations (id),
  -- Correo a todas las cuentas Raíz activas de la organización.
  infra_email      boolean not null,
  -- Chat de Telegram de infraestructura (`integrations.kind = 'telegram_infra'`), si hay uno activo.
  infra_telegram   boolean not null,
  updated_by       uuid not null,
  updated_at       timestamptz not null default now(),
  version          integer not null default 1 check (version > 0),
  constraint alert_settings_one_infra_channel check (infra_email or infra_telegram),
  foreign key (organization_id, updated_by) references users (organization_id, id)
);
comment on table alert_settings is
  'Canales por los que la Raíz recibe las alertas de infraestructura (correo y/o Telegram). Sin fila: ambos encendidos.';
comment on column alert_settings.infra_email is 'true = la alerta de infraestructura se envía por correo a las cuentas Raíz activas.';
comment on column alert_settings.infra_telegram is 'true = la alerta de infraestructura se envía al chat de Telegram de infraestructura, si hay uno activo.';
comment on column alert_settings.version is 'Sube en cada cambio; el caso de uso la usa para detectar escrituras simultáneas.';
create trigger alert_settings_touch before update on alert_settings
  for each row execute function touch_updated_at();

alter table alert_settings enable row level security;
alter table alert_settings force row level security;
create policy alert_settings_tenant_isolation on alert_settings for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Sin `organization_id` en el UPDATE: un ajuste no cambia de organización. Sin DELETE ni TRUNCATE.
grant select, insert, update (infra_email, infra_telegram, updated_by, updated_at, version)
  on alert_settings to iam_app;
