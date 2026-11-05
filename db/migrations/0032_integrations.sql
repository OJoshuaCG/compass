-- 0032: integraciones configurables por la persona administradora (ADR 0047, tarea T3).
--
-- Dos tablas nuevas, cada una con organización, índice que empieza por ella y política de aislamiento
-- por filas en esta misma migración:
--  * `integrations`: una integración configurada (canal de Telegram de infraestructura, canal de
--    Telegram de seguridad o consulta de SMS por API). Solo guarda configuración NO secreta.
--  * `integration_secrets`: el secreto de cada integración (token del bot o llave de API), cifrado por
--    el módulo de criptografía con el mismo patrón que la contraseña del buzón (migración 0029).
--
-- Decisiones de privilegios:
--  * Solo la API (`iam_app`) toca estas tablas. Ningún otro rol recibe permisos: el sondeo de SMS
--    (T5) pedirá los suyos en su propia migración, con el mismo cuidado que la 0029.
--  * Ninguna tabla permite DELETE: una integración se archiva y su secreto se reemplaza, nunca se
--    borra, para que la auditoría siga apuntando a filas que existen.
--  * La API puede leer y reemplazar el texto cifrado: el recifrado por rotación de DEK (ADR 0040) lo
--    necesita; sin él, la DEK anterior no se podría retirar.
--  * Límites que la base NO impone: (a) que `ciphertext` salga del módulo de criptografía (solo se
--    exige largo mínimo); (b) qué campos de `config` son válidos para cada tipo: lo valida el dominio.

-- integrations ------------------------------------------------------------------------------
create table integrations (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  -- telegram_infra: avisos de infraestructura (solo Raíz); telegram_security: avisos de seguridad
  -- (Raíz y Administrador); sms_pull: consulta periódica de una API de SMS definida por la persona.
  kind            text not null check (kind in ('telegram_infra', 'telegram_security', 'sms_pull')),
  name            text not null check (length(btrim(name)) between 1 and 200),
  status          text not null default 'active' check (status in ('active', 'archived')),
  -- Configuración no secreta validada por el dominio. Nunca lleva tokens, llaves ni contraseñas.
  config          jsonb not null default '{}'::jsonb check (
    jsonb_typeof(config) = 'object' and octet_length(config::text) <= 8192
  ),
  created_by      uuid not null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  unique (organization_id, id),
  constraint integrations_archived_consistent check ((status = 'archived') = (archived_at is not null)),
  foreign key (organization_id, created_by) references users (organization_id, id)
);
comment on table integrations is 'Integración configurada por la persona administradora (ADR 0047). Solo configuración no secreta.';
comment on column integrations.kind is 'telegram_infra = avisos de infraestructura (Raíz); telegram_security = avisos de seguridad; sms_pull = consulta de SMS por API.';
comment on column integrations.config is 'Configuración no secreta validada por el dominio; máximo 8 KiB. Nunca contiene secretos.';
create index integrations_org_kind_status on integrations (organization_id, kind, status);
-- Un solo canal de Telegram activo de cada tipo por organización: evita avisos duplicados o enviados a
-- un destino que nadie considera vigente. El SMS sí admite varias integraciones activas.
create unique index integrations_one_active_telegram_channel
  on integrations (organization_id, kind)
  where status = 'active' and kind in ('telegram_infra', 'telegram_security');
create trigger integrations_touch before update on integrations
  for each row execute function touch_updated_at();

-- integration_secrets -----------------------------------------------------------------------
create table integration_secrets (
  organization_id uuid not null references organizations (id),
  integration_id  uuid not null,
  -- bot_token: token del bot de Telegram; api_key: valor del encabezado de autenticación de la API de SMS.
  field           text not null check (field in ('bot_token', 'api_key')),
  ciphertext      bytea not null check (octet_length(ciphertext) >= 16),
  nonce           bytea not null check (octet_length(nonce) = 12),
  dek_version     integer not null check (dek_version > 0),
  -- Versión del secreto dentro de su contexto de cifrado (AAD): sube cada vez que se reintroduce.
  secret_version  integer not null default 1 check (secret_version > 0),
  -- Fecha de la última reintroducción por una persona. El recifrado por rotación de DEK NO la cambia.
  rotated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  primary key (organization_id, integration_id, field),
  foreign key (organization_id, integration_id) references integrations (organization_id, id),
  foreign key (organization_id, dek_version) references data_keys (organization_id, version)
);
comment on table integration_secrets is 'Secreto cifrado de una integración (token de bot o llave de API); uno por campo (ADR 0047).';
comment on column integration_secrets.secret_version is 'Versión del secreto dentro del contexto de cifrado (AAD); sube al reintroducirlo.';
comment on column integration_secrets.rotated_at is 'Última vez que una persona reintrodujo el secreto; el recifrado por rotación de DEK no la modifica.';
create index integration_secrets_dek on integration_secrets (organization_id, dek_version);

-- Aislamiento por filas -----------------------------------------------------------------------
alter table integrations enable row level security;
alter table integrations force row level security;
create policy integrations_tenant_isolation on integrations for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

alter table integration_secrets enable row level security;
alter table integration_secrets force row level security;
create policy integration_secrets_tenant_isolation on integration_secrets for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- API (iam_app) -------------------------------------------------------------------------------
-- Sin `organization_id`, `kind` ni `created_by` en el UPDATE: una integración no cambia de tipo ni de dueño.
grant select, insert, update (name, status, config, archived_at, version, updated_at)
  on integrations to iam_app;
-- Sin `field` ni `integration_id` en el UPDATE: el secreto pertenece a su integración y a su campo.
grant select, insert, update (ciphertext, nonce, dek_version, secret_version, rotated_at)
  on integration_secrets to iam_app;
