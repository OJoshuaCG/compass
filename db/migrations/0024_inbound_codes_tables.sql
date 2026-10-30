-- 0024: tablas de la lectura de códigos entrantes (ADR 0045, IC-2b).
--
-- Fuentes (buzón o número), plantillas, vistas compartibles, referencias vista-plantilla, elementos
-- extraídos (código o enlace cifrados) y el historial de recepciones, que también hace de
-- deduplicación y de cuarentena (solo metadatos). Cada tabla lleva organización, índice que empieza
-- por ella y política de aislamiento por filas en esta misma migración. No guarda credenciales de
-- buzones ni cuerpos de mensajes; eso, si llega, es de otra rebanada.
--
-- NO incluye la conciliación con `accounts.recovery_email_alias` (espacio de nombres distinto del de
-- `mail_sources.address`): un guardia entre tablas no puede ver otra organización bajo el aislamiento por
-- filas, así que se resuelve en la función de resolución previa a la autenticación (IC-2c), que sí puede.
--
-- Además amplía `shares` para que `mail_source` y `mail_view` sean recursos compartibles: el CHECK de
-- `resource_type` y el trigger `shares_check_refs` (0005) se redefinen aquí; 0005 no se edita.

-- inbound_templates -----------------------------------------------------------------------
-- Regla de remitente, asunto y extracción. `definition` la valida el dominio (`findTemplateProblems`)
-- al guardar; la base solo exige que sea un objeto. El tipo no lo cambia quien configura fuentes:
-- es una acción de plataforma (ADR 0045, sección 1).
create table inbound_templates (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  name            text not null check (length(btrim(name)) between 1 and 200),
  kind            text not null check (kind in ('login_code', 'reset_code', 'reset_link')),
  definition      jsonb not null check (jsonb_typeof(definition) = 'object'),
  platform_id     uuid references platforms (id),
  created_by      uuid not null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  unique (organization_id, id),
  -- Permite que un elemento referencie la plantilla Y su tipo: el tipo del elemento no puede divergir.
  unique (organization_id, id, kind),
  foreign key (organization_id, created_by) references users (organization_id, id)
);
create index inbound_templates_org_live on inbound_templates (organization_id, kind) where archived_at is null;
create trigger inbound_templates_touch before update on inbound_templates
  for each row execute function touch_updated_at();

-- mail_sources ----------------------------------------------------------------------------
-- Una dirección de correo o un número de SMS de la organización. La dirección es única en toda la
-- base (no solo por organización) porque la resolución previa a la autenticación (IC-2c) debe
-- identificar la organización solo con ella; el precio es que un conflicto de dirección revela que
-- existe en otra organización (mismo compromiso que `accounts.recovery_email_alias`). Una dirección
-- archivada no se reutiliza.
create table mail_sources (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  channel         text not null check (channel in ('mail', 'sms')),
  address         text not null check (length(address) between 3 and 320 and address = lower(address)),
  display_name    text not null check (length(btrim(display_name)) between 1 and 200),
  -- Cuenta de la bóveda a la que está ligada (opcional). Archivar la cuenta suspende la fuente.
  account_id      uuid,
  status          text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_by      uuid not null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  unique (organization_id, id),
  unique (channel, address),
  constraint mail_sources_archived_consistent check ((status = 'archived') = (archived_at is not null)),
  foreign key (organization_id, account_id) references accounts (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id)
);
create index mail_sources_org_status on mail_sources (organization_id, status);
create index mail_sources_org_account on mail_sources (organization_id, account_id) where account_id is not null;
create trigger mail_sources_touch before update on mail_sources
  for each row execute function touch_updated_at();

-- mail_views ------------------------------------------------------------------------------
-- Conjunto con nombre de plantillas de UNA fuente: es lo que se comparte para leer.
create table mail_views (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  source_id       uuid not null,
  name            text not null check (length(btrim(name)) between 1 and 200),
  created_by      uuid not null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, source_id) references mail_sources (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id)
);
create unique index mail_views_live_name on mail_views (organization_id, source_id, name) where archived_at is null;
create trigger mail_views_touch before update on mail_views
  for each row execute function touch_updated_at();

-- mail_view_templates ---------------------------------------------------------------------
create table mail_view_templates (
  organization_id uuid not null references organizations (id),
  view_id         uuid not null,
  template_id     uuid not null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, view_id, template_id),
  foreign key (organization_id, view_id) references mail_views (organization_id, id),
  foreign key (organization_id, template_id) references inbound_templates (organization_id, id)
);
create index mail_view_templates_template on mail_view_templates (organization_id, template_id);

-- inbound_items ---------------------------------------------------------------------------
-- El código o enlace extraído, cifrado por el módulo de criptografía; vence a los 10 minutos y lo
-- vencido nunca se devuelve aunque la purga no haya corrido. Es inmutable (sin UPDATE).
create table inbound_items (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  source_id       uuid not null,
  template_id     uuid not null,
  kind            text not null check (kind in ('login_code', 'reset_code', 'reset_link')),
  value_type      text not null check (value_type in ('code', 'link')),
  visibility      text not null check (visibility in ('visible_with_use', 'sensitive')),
  ciphertext      bytea not null check (octet_length(ciphertext) >= 16),
  nonce           bytea not null check (octet_length(nonce) = 12),
  dek_version     integer not null check (dek_version > 0),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  -- Falla cerrada también en la base: solo un `login_code` explícito puede ser visible con USE, y un
  -- enlace nunca lo es (ADR 0045, sección 1; el dominio ya lo garantiza, esto es la segunda barrera).
  constraint inbound_items_visible_only_login_code check (visibility = 'sensitive' or kind = 'login_code'),
  -- Un enlace solo lo produce una plantilla `reset_link` y una plantilla `reset_link` solo produce enlaces
  -- (igual que KIND_EXTRACTION_MISMATCH del dominio); como `reset_link` nunca es visible, un enlace tampoco.
  constraint inbound_items_link_matches_kind check ((value_type = 'link') = (kind = 'reset_link')),
  foreign key (organization_id, source_id) references mail_sources (organization_id, id),
  -- Con el tipo dentro de la clave, el elemento hereda el tipo de SU plantilla; no se puede declarar
  -- `login_code` sobre una plantilla de restablecimiento.
  foreign key (organization_id, template_id, kind) references inbound_templates (organization_id, id, kind),
  foreign key (organization_id, dek_version) references data_keys (organization_id, version)
);
create index inbound_items_source_expiry on inbound_items (organization_id, source_id, expires_at desc);
create index inbound_items_expiry on inbound_items (organization_id, expires_at);

-- inbound_receipts ------------------------------------------------------------------------
-- Historial mínimo de cada mensaje aceptado o a cuarentena, sin asunto, remitente ni valores. La
-- restricción única hace de deduplicación: el mismo mensaje del proveedor no genera dos registros.
create table inbound_receipts (
  id                  uuid primary key default uuid_generate_v7(),
  organization_id     uuid not null references organizations (id),
  source_id           uuid not null,
  -- Hash ya calculado del identificador del mensaje del proveedor, nunca el identificador en claro.
  message_fingerprint text not null check (message_fingerprint ~ '^[!-~]{1,128}$'),
  outcome             text not null check (outcome in ('accepted', 'quarantined')),
  -- Motivo enumerado de cuarentena (`QUARANTINE_REASONS` del dominio); solo si hubo cuarentena.
  reason              text check (reason is null or reason ~ '^[A-Z_]{1,64}$'),
  signing_domain      text check (signing_domain is null or length(signing_domain) <= 253),
  template_kind       text check (template_kind is null or template_kind in ('login_code', 'reset_code', 'reset_link')),
  item_id             uuid,
  received_at         timestamptz not null,
  created_at          timestamptz not null default now(),
  unique (organization_id, source_id, message_fingerprint),
  constraint inbound_receipts_reason_consistent check ((outcome = 'quarantined') = (reason is not null)),
  -- Una cuarentena nunca produjo un elemento.
  constraint inbound_receipts_item_only_accepted check (outcome = 'accepted' or item_id is null),
  foreign key (organization_id, source_id) references mail_sources (organization_id, id),
  -- La purga del elemento no borra el historial: solo suelta la referencia.
  foreign key (organization_id, item_id) references inbound_items (organization_id, id)
    on delete set null (item_id)
);
create index inbound_receipts_source_time on inbound_receipts (organization_id, source_id, received_at desc);
create index inbound_receipts_time on inbound_receipts (organization_id, received_at);
-- Sostiene el `on delete set null (item_id)` al purgar elementos: sin él cada borrado recorre las recepciones.
create index inbound_receipts_item on inbound_receipts (organization_id, item_id) where item_id is not null;

-- Aislamiento por filas y permisos ---------------------------------------------------------
alter table inbound_templates enable row level security;
alter table inbound_templates force row level security;
create policy inbound_templates_tenant_isolation on inbound_templates for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Sin `kind`: cambiar el tipo de una plantilla es una acción de plataforma que se hace archivando y
-- creando otra (ADR 0045, sección 1), no un UPDATE.
grant select, insert, update (name, definition, platform_id, archived_at, version, updated_at) on inbound_templates to iam_app;

alter table mail_sources enable row level security;
alter table mail_sources force row level security;
create policy mail_sources_tenant_isolation on mail_sources for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Sin `address` ni `channel`: una dirección archivada no se reutiliza ni se reasigna.
grant select, insert, update (display_name, account_id, status, archived_at, version, updated_at) on mail_sources to iam_app;

alter table mail_views enable row level security;
alter table mail_views force row level security;
create policy mail_views_tenant_isolation on mail_views for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Sin `source_id`: una vista pertenece a una sola fuente para siempre.
grant select, insert, update (name, archived_at, version, updated_at) on mail_views to iam_app;

alter table mail_view_templates enable row level security;
alter table mail_view_templates force row level security;
create policy mail_view_templates_tenant_isolation on mail_view_templates for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, delete on mail_view_templates to iam_app;

alter table inbound_items enable row level security;
alter table inbound_items force row level security;
create policy inbound_items_tenant_isolation on inbound_items for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, delete on inbound_items to iam_app;

alter table inbound_receipts enable row level security;
alter table inbound_receipts force row level security;
create policy inbound_receipts_tenant_isolation on inbound_receipts for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- La purga por retención borra recepciones viejas; nunca se actualizan.
grant select, insert, delete on inbound_receipts to iam_app;

-- shares: nuevos tipos de recurso --------------------------------------------------------
alter table shares drop constraint shares_resource_type_check;
alter table shares add constraint shares_resource_type_check
  check (resource_type in ('account', 'mail_source', 'mail_view'));

-- Misma función de 0005 con dos ramas más: el recurso debe existir y ser de la misma organización
-- (el trigger corre como quien invoca, con el aislamiento por filas aplicado).
create or replace function shares_check_refs() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.resource_type = 'account'
     and not exists (select 1 from public.accounts a where a.id = new.resource_id and a.organization_id = new.organization_id) then
    raise exception 'share resource % not found in this organization', new.resource_id using errcode = '23503';
  end if;
  if new.resource_type = 'mail_source'
     and not exists (select 1 from public.mail_sources s where s.id = new.resource_id and s.organization_id = new.organization_id) then
    raise exception 'share resource % not found in this organization', new.resource_id using errcode = '23503';
  end if;
  if new.resource_type = 'mail_view'
     and not exists (select 1 from public.mail_views v where v.id = new.resource_id and v.organization_id = new.organization_id) then
    raise exception 'share resource % not found in this organization', new.resource_id using errcode = '23503';
  end if;
  if new.grantee_type = 'user'
     and not exists (select 1 from public.users u where u.id = new.grantee_id and u.organization_id = new.organization_id) then
    raise exception 'share grantee user % not found in this organization', new.grantee_id using errcode = '23503';
  end if;
  if new.grantee_type = 'group'
     and not exists (select 1 from public.groups g where g.id = new.grantee_id and g.organization_id = new.organization_id) then
    raise exception 'share grantee group % not found in this organization', new.grantee_id using errcode = '23503';
  end if;
  return new;
end
$$;
