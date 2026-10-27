-- 0002: organizations and the identity module.
-- Every domain table: organization_id not null, an index that starts with it, and RLS
-- (ENABLE + FORCE) in this same migration. FORCE makes the owner subject to policies too, so
-- a migration or an operator session without app.org_id cannot read tenant data by accident.
--
-- Policy predicate (fail closed): nullif(current_setting('app.org_id', true), '')::uuid
--  * missing_ok = true  -> NULL when the variable was never set
--  * nullif(..., '')    -> after SET LOCAL ends, the placeholder survives as '' on that
--                          connection; '' would raise on the uuid cast instead of returning no rows
--  * org = NULL         -> never true, so zero rows

create table organizations (
  id             uuid primary key default uuid_generate_v7(),
  name           text not null check (length(btrim(name)) between 1 and 200),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status         text not null default 'active' check (status in ('active', 'suspended')),
  settings       jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  default_locale text not null default 'es-MX' check (default_locale in ('es-MX', 'en-US')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1
);
create trigger organizations_touch before update on organizations
  for each row execute function touch_updated_at();

alter table organizations enable row level security;
alter table organizations force row level security;
-- No organization_id column: the row itself is the tenant. Organizations are created by an
-- audited operations script (migrator/superuser), never by iam_app.
create policy organizations_self_read on organizations for select
  using (id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy organizations_self_update on organizations for update
  using (id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, update (name, status, settings, default_locale, updated_at, version) on organizations to iam_app;

-- users ---------------------------------------------------------------------------------
create table users (
  id            uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  email         text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  display_name  text not null check (length(btrim(display_name)) between 1 and 200),
  rank          smallint not null check (rank between 0 and 3),
  status        text not null default 'invited'
                check (status in ('invited', 'active', 'suspended', 'deactivated')),
  managed_by    uuid,
  created_by    uuid,
  locale        text not null default 'es-MX' check (locale in ('es-MX', 'en-US')),
  timezone      text not null default 'UTC',
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  unique (organization_id, id),
  -- Composite FKs: a row can only point at a row of its own organization. FK checks bypass
  -- RLS, so this is the only guard against cross-tenant references.
  foreign key (organization_id, managed_by) references users (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id),
  -- Only the Root has no responsible; everybody else must have one (rule 3).
  constraint users_root_has_no_manager check ((rank = 0) = (managed_by is null)),
  constraint users_no_self_management check (managed_by is distinct from id)
);
-- Rule 1: exactly one active Root per organization.
create unique index users_one_active_root on users (organization_id) where rank = 0 and status <> 'deactivated';
create index users_org_status on users (organization_id, status);
create index users_org_managed_by on users (organization_id, managed_by);
create index users_org_rank on users (organization_id, rank);
create trigger users_touch before update on users for each row execute function touch_updated_at();

alter table users enable row level security;
alter table users force row level security;
create policy users_tenant_isolation on users for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- No DELETE: users are never removed (rule 8).
grant select, insert, update on users to iam_app;

-- user_passwords ------------------------------------------------------------------------
create table user_passwords (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  user_id         uuid not null,
  argon2_hash     text not null check (argon2_hash like '$argon2id$%'),
  changed_at      timestamptz not null default now(),
  must_change     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
create trigger user_passwords_touch before update on user_passwords for each row execute function touch_updated_at();
alter table user_passwords enable row level security;
alter table user_passwords force row level security;
create policy user_passwords_tenant_isolation on user_passwords for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on user_passwords to iam_app;

-- webauthn_credentials ------------------------------------------------------------------
create table webauthn_credentials (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  user_id         uuid not null,
  credential_id   bytea not null unique,
  public_key      bytea not null,
  sign_count      bigint not null default 0 check (sign_count >= 0),
  transports      text[] not null default '{}',
  name            text not null check (length(btrim(name)) between 1 and 100),
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
create index webauthn_credentials_org_user on webauthn_credentials (organization_id, user_id);
create trigger webauthn_credentials_touch before update on webauthn_credentials for each row execute function touch_updated_at();
alter table webauthn_credentials enable row level security;
alter table webauthn_credentials force row level security;
create policy webauthn_credentials_tenant_isolation on webauthn_credentials for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on webauthn_credentials to iam_app;

-- user_totp_factors (MFA of the system itself) ------------------------------------------
-- nonce and dek_version are required to open the ciphertext with SecretCipher (AAD:
-- org_id | id | field | version), see plan "Formato de cada secreto".
create table user_totp_factors (
  id                uuid primary key default uuid_generate_v7(),
  organization_id   uuid not null references organizations (id),
  user_id           uuid not null,
  secret_ciphertext bytea not null,
  nonce             bytea not null check (octet_length(nonce) = 12),
  dek_version       integer not null check (dek_version > 0),
  verified_at       timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
create unique index user_totp_factors_one_live on user_totp_factors (organization_id, user_id) where revoked_at is null;
create trigger user_totp_factors_touch before update on user_totp_factors for each row execute function touch_updated_at();
alter table user_totp_factors enable row level security;
alter table user_totp_factors force row level security;
create policy user_totp_factors_tenant_isolation on user_totp_factors for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on user_totp_factors to iam_app;

-- user_recovery_codes -------------------------------------------------------------------
create table user_recovery_codes (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  user_id         uuid not null,
  code_hash       bytea not null check (octet_length(code_hash) = 32),
  used_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id, code_hash),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
alter table user_recovery_codes enable row level security;
alter table user_recovery_codes force row level security;
create policy user_recovery_codes_tenant_isolation on user_recovery_codes for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on user_recovery_codes to iam_app;

-- sessions ------------------------------------------------------------------------------
-- Only the SHA-256 of the 256-bit opaque token is stored. last_seen_at supports the 30 minute
-- inactivity expiry. Ephemeral data with TTL: expired rows may be purged physically.
create table sessions (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  user_id         uuid not null,
  token_hash      bytea not null unique check (octet_length(token_hash) = 32),
  ip              inet,
  user_agent      text,
  mfa_at          timestamptz,
  reauth_at       timestamptz,
  last_seen_at    timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
create index sessions_org_user_live on sessions (organization_id, user_id) where revoked_at is null;
create index sessions_org_expires on sessions (organization_id, expires_at);
alter table sessions enable row level security;
alter table sessions force row level security;
create policy sessions_tenant_isolation on sessions for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on sessions to iam_app;

-- invitations ---------------------------------------------------------------------------
-- rank 1..3: nobody is invited as Root. managed_by and role_ids carry the creation-time
-- choices from plan "Alta de usuarios"; role_ids is not FK-enforced (arrays cannot be) and is
-- revalidated by the domain when the invitation is accepted.
create table invitations (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  email           text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  rank            smallint not null check (rank between 1 and 3),
  invited_by      uuid not null,
  managed_by      uuid not null,
  role_ids        uuid[] not null default '{}',
  token_hash      bytea not null unique check (octet_length(token_hash) = 32),
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, invited_by) references users (organization_id, id),
  foreign key (organization_id, managed_by) references users (organization_id, id)
);
-- Resending revokes the previous invitation first, so at most one is pending per email.
create unique index invitations_one_pending_per_email on invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_org_invited_by on invitations (organization_id, invited_by);
alter table invitations enable row level security;
alter table invitations force row level security;
create policy invitations_tenant_isolation on invitations for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on invitations to iam_app;
