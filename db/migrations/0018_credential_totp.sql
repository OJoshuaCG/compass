-- Vault two-factor state (B4a). One row per credential describes its CURRENT TOTP registration.
-- The secret itself never lives here: it is the encrypted `totp_uri` field in credential_secrets;
-- `secret_version` points at the version this row describes. Older versions stay in credential_secrets
-- (the retention job purges non-current ones after 30 days).

create table credential_totp (
  id               uuid primary key default uuid_generate_v7(),
  organization_id  uuid not null references organizations (id),
  credential_id    uuid not null,
  secret_version   integer not null check (secret_version >= 1),
  -- pending: registered, nobody confirmed the code yet. verified: confirmed. retired: switched off.
  status           text not null check (status in ('pending', 'verified', 'retired')),
  algorithm        text not null check (algorithm in ('SHA1', 'SHA256', 'SHA512')),
  digits           smallint not null check (digits in (6, 8)),
  period_seconds   smallint not null check (period_seconds in (30, 60)),
  registered_by    uuid not null,
  registered_at    timestamptz not null default now(),
  verified_at      timestamptz,
  retired_at       timestamptz,
  -- Set when the secret was exported (QR or key shown): the secret is no longer known only to the vault.
  exposed_at       timestamptz,
  -- Set once the "registered but never confirmed for 24 h" notice was queued, so it is sent only once.
  pending_notice_at timestamptz,
  updated_at       timestamptz not null default now(),
  unique (organization_id, credential_id),
  foreign key (organization_id, credential_id) references credentials (organization_id, id),
  foreign key (organization_id, registered_by) references users (organization_id, id),
  check (status <> 'verified' or verified_at is not null),
  check (status <> 'retired' or retired_at is not null)
);
comment on table credential_totp is 'Current TOTP registration of a credential; the secret is the encrypted totp_uri field in credential_secrets.';
comment on column credential_totp.secret_version is 'Version of the totp_uri field in credential_secrets that this row describes.';
comment on column credential_totp.exposed_at is 'When the secret was last exported (QR or key shown to a person).';
comment on column credential_totp.pending_notice_at is 'When the 24 h "registered but not confirmed" notice was queued; null until then.';

create index credential_totp_org_pending on credential_totp (organization_id, registered_at) where status = 'pending';
create trigger credential_totp_touch before update on credential_totp for each row execute function touch_updated_at();

alter table credential_totp enable row level security;
alter table credential_totp force row level security;
create policy credential_totp_tenant_isolation on credential_totp for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on credential_totp to iam_app;
