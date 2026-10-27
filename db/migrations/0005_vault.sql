-- 0005: vault. Platform (Instagram) -> account (@brand on Instagram) -> credential (one access)
-- -> secret (encrypted field versions); shares grant access to users or groups.

-- platforms: global catalog rows have organization_id NULL and are read-only for iam_app;
-- each organization may add its own rows. Separate policies per command make that explicit:
-- NULL = cur is never true, so no write policy can ever match a global row.
create table platforms (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid references organizations (id),
  name            text not null check (length(btrim(name)) between 1 and 200),
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  login_url       text check (login_url is null or login_url ~ '^https://[^\s]+$'),
  icon            text,
  supports_totp   boolean not null default true,
  login_strategy  jsonb not null default '{}'::jsonb check (jsonb_typeof(login_strategy) = 'object'),
  mail_rules      jsonb not null default '{}'::jsonb check (jsonb_typeof(mail_rules) = 'object'),
  -- Length/symbol limits some platforms impose (plan "Generador de contraseñas").
  password_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(password_policy) = 'object'),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1
);
create unique index platforms_global_slug on platforms (slug) where organization_id is null;
create unique index platforms_org_slug on platforms (organization_id, slug) where organization_id is not null;
create trigger platforms_touch before update on platforms for each row execute function touch_updated_at();

alter table platforms enable row level security;
alter table platforms force row level security;
-- The global catalog is readable only inside an organization context: without app.org_id the
-- policy yields zero rows, like every other table (fail closed, no special case).
create policy platforms_read on platforms for select
  using (
    nullif(current_setting('app.org_id', true), '')::uuid is not null
    and (organization_id is null or organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  );
create policy platforms_insert on platforms for insert
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy platforms_update on platforms for update
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on platforms to iam_app;

-- Seed the global catalog. FORCE is lifted only inside this transaction so the table owner
-- (whoever runs the migration) can insert rows that no tenant policy would allow.
alter table platforms no force row level security;
insert into platforms (name, slug, login_url, supports_totp) values
  ('Instagram',        'instagram', 'https://www.instagram.com/accounts/login/', true),
  ('Facebook',         'facebook',  'https://www.facebook.com/login/',           true),
  ('TikTok',           'tiktok',    'https://www.tiktok.com/login',              true),
  ('YouTube / Google', 'youtube',   'https://accounts.google.com/',              true),
  ('X',                'x',         'https://x.com/i/flow/login',                true),
  ('LinkedIn',         'linkedin',  'https://www.linkedin.com/login',            true),
  ('Pinterest',        'pinterest', 'https://www.pinterest.com/login/',          true),
  ('Threads',          'threads',   'https://www.threads.net/login',             true),
  ('Gmail',            'gmail',     'https://accounts.google.com/',              true),
  ('Outlook',          'outlook',   'https://login.live.com/',                   true),
  -- "Personalizada": any site, the URL is captured per account.
  ('Personalizada',    'custom',    null,                                        true);
alter table platforms force row level security;

-- accounts ------------------------------------------------------------------------------
create table accounts (
  id                    uuid primary key default uuid_generate_v7(),
  organization_id       uuid not null references organizations (id),
  platform_id           uuid not null references platforms (id),
  display_name          text not null check (length(btrim(display_name)) between 1 and 200),
  handle                text,
  -- Globally unique: in phase 4 the alias alone identifies the destination account and org.
  recovery_email_alias  text unique check (recovery_email_alias is null or recovery_email_alias = lower(recovery_email_alias)),
  owner_group_id        uuid,
  tags                  text[] not null default '{}',
  status                text not null default 'active' check (status in ('active', 'archived')),
  created_by            uuid not null,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, owner_group_id) references groups (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id),
  constraint accounts_archived_consistent check ((status = 'archived') = (archived_at is not null))
);
create index accounts_org_platform on accounts (organization_id, platform_id);
create index accounts_org_owner_group on accounts (organization_id, owner_group_id);
create index accounts_org_handle on accounts (organization_id, lower(handle));
create index accounts_tags on accounts using gin (tags);
create trigger accounts_touch before update on accounts for each row execute function touch_updated_at();

-- platform_id is a plain FK (global rows have no organization), and FK checks bypass RLS.
-- This trigger runs as the invoker, so RLS hides other tenants' platforms from it.
create function accounts_check_platform_visible() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from public.platforms p where p.id = new.platform_id) then
    raise exception 'platform % is not visible to this organization', new.platform_id
      using errcode = '23503';
  end if;
  return new;
end
$$;
create trigger accounts_platform_scope before insert or update of platform_id on accounts
  for each row execute function accounts_check_platform_visible();

alter table accounts enable row level security;
alter table accounts force row level security;
create policy accounts_tenant_isolation on accounts for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on accounts to iam_app;

-- credentials ---------------------------------------------------------------------------
create table credentials (
  id               uuid primary key default uuid_generate_v7(),
  organization_id  uuid not null references organizations (id),
  account_id       uuid not null,
  label            text not null check (length(btrim(label)) between 1 and 200),
  kind             text not null check (kind in ('password', 'password_totp', 'totp_only')),
  last_rotated_at  timestamptz,
  health           jsonb not null default '{}'::jsonb check (jsonb_typeof(health) = 'object'),
  created_by       uuid not null,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, account_id) references accounts (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id)
);
create index credentials_org_account on credentials (organization_id, account_id);
create trigger credentials_touch before update on credentials for each row execute function touch_updated_at();
alter table credentials enable row level security;
alter table credentials force row level security;
create policy credentials_tenant_isolation on credentials for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on credentials to iam_app;

-- credential_secrets --------------------------------------------------------------------
-- Each change inserts a new version; older ones are kept (30 days by default) so a failed
-- rotation can be recovered. ciphertext includes the 16-byte GCM tag. blind_index is the
-- per-organization HMAC used for exact username lookups (never the plaintext).
create table credential_secrets (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  credential_id   uuid not null,
  field           text not null check (field in ('username', 'password', 'totp_uri', 'recovery_codes', 'secret_notes')),
  version         integer not null check (version > 0),
  ciphertext      bytea not null check (octet_length(ciphertext) >= 16),
  nonce           bytea not null check (octet_length(nonce) = 12),
  dek_version     integer not null check (dek_version > 0),
  is_current      boolean not null default true,
  blind_index     bytea check (blind_index is null or octet_length(blind_index) = 32),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, credential_id, field, version),
  foreign key (organization_id, credential_id) references credentials (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id),
  foreign key (organization_id, dek_version) references data_keys (organization_id, version)
);
create unique index credential_secrets_one_current on credential_secrets (organization_id, credential_id, field)
  where is_current;
create index credential_secrets_blind on credential_secrets (organization_id, field, blind_index)
  where blind_index is not null;
alter table credential_secrets enable row level security;
alter table credential_secrets force row level security;
create policy credential_secrets_read on credential_secrets for select
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy credential_secrets_insert on credential_secrets for insert
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy credential_secrets_update on credential_secrets for update
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Only superseded versions may be destroyed by the retention job; the current one never.
create policy credential_secrets_purge_old on credential_secrets for delete
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid and not is_current);
-- The ciphertext and its binding fields are immutable; only the current flag flips.
grant select, insert, update (is_current), delete on credential_secrets to iam_app;

-- shares --------------------------------------------------------------------------------
-- resource_id / grantee_id are polymorphic, so there is no FK; the trigger below verifies them
-- as the invoker (RLS-scoped). Revoking sets revoked_at: who had access when is forensic data.
create table shares (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  resource_type   text not null check (resource_type in ('account')),
  resource_id     uuid not null,
  grantee_type    text not null check (grantee_type in ('user', 'group')),
  grantee_id      uuid not null,
  level           text not null check (level in ('USE', 'VIEW', 'EDIT', 'MANAGE')),
  expires_at      timestamptz,
  granted_by      uuid not null,
  reason          text,
  revoked_at      timestamptz,
  revoked_by      uuid,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, granted_by) references users (organization_id, id),
  foreign key (organization_id, revoked_by) references users (organization_id, id),
  constraint shares_revoked_consistent check ((revoked_at is null) = (revoked_by is null))
);
create unique index shares_one_live_per_grantee on shares
  (organization_id, resource_type, resource_id, grantee_type, grantee_id) where revoked_at is null;
create index shares_org_grantee on shares (organization_id, grantee_type, grantee_id) where revoked_at is null;

create function shares_check_refs() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.resource_type = 'account'
     and not exists (select 1 from public.accounts a where a.id = new.resource_id and a.organization_id = new.organization_id) then
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
create trigger shares_refs before insert or update of resource_id, resource_type, grantee_id, grantee_type on shares
  for each row execute function shares_check_refs();

alter table shares enable row level security;
alter table shares force row level security;
create policy shares_tenant_isolation on shares for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on shares to iam_app;

-- password_fingerprints: HMAC (never text) to detect reuse across credentials -------------
create table password_fingerprints (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  credential_id   uuid not null,
  hmac            bytea not null check (octet_length(hmac) = 32),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, credential_id),
  foreign key (organization_id, credential_id) references credentials (organization_id, id)
);
create index password_fingerprints_org_hmac on password_fingerprints (organization_id, hmac);
create trigger password_fingerprints_touch before update on password_fingerprints for each row execute function touch_updated_at();
alter table password_fingerprints enable row level security;
alter table password_fingerprints force row level security;
create policy password_fingerprints_tenant_isolation on password_fingerprints for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on password_fingerprints to iam_app;
