-- 0011: challenges of the WebAuthn ceremonies (passkey registration and sign-in).
-- A challenge is random, single use and short lived; it is bound to the user and to the purpose so a
-- challenge issued for one ceremony can never validate another. Ephemeral data with TTL.
create table webauthn_challenges (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  user_id         uuid not null,
  purpose         text not null check (purpose in ('registration', 'authentication')),
  challenge       text not null check (length(challenge) between 16 and 512),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, user_id) references users (organization_id, id)
);
create index webauthn_challenges_org_user on webauthn_challenges (organization_id, user_id, purpose)
  where used_at is null;
alter table webauthn_challenges enable row level security;
alter table webauthn_challenges force row level security;
create policy webauthn_challenges_tenant_isolation on webauthn_challenges for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on webauthn_challenges to iam_app;
