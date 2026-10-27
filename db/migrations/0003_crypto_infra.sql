-- 0003: crypto (data_keys) and infrastructure (outbox, idempotency).

-- data_keys: one wrapped DEK per organization and version. The KEK never leaves the KMS.
create table data_keys (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  version         integer not null check (version > 0),
  wrapped_dek     bytea not null,
  kms_key_ref     text not null,
  status          text not null default 'active' check (status in ('active', 'retired')),
  created_at      timestamptz not null default now(),
  unique (organization_id, version)
);
-- One active DEK per organization; older versions stay 'retired' to decrypt old secrets.
create unique index data_keys_one_active on data_keys (organization_id) where status = 'active';
alter table data_keys enable row level security;
alter table data_keys force row level security;
create policy data_keys_tenant_isolation on data_keys for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Key material is immutable: only the status may change (rotation retires a version).
grant select, insert, update (status) on data_keys to iam_app;

-- outbox_events: written in the same transaction as the change, published by the worker.
-- attempts / next_attempt_at back the "retries with backoff" rule.
create table outbox_events (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  aggregate       text not null,
  type            text not null,
  payload         jsonb not null,
  published_at    timestamptz,
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index outbox_events_org_pending on outbox_events (organization_id, next_attempt_at) where published_at is null;
alter table outbox_events enable row level security;
alter table outbox_events force row level security;
create policy outbox_events_tenant_isolation on outbox_events for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Ephemeral: published events may be purged.
grant select, insert, update, delete on outbox_events to iam_app;

-- idempotency_keys: replay protection for mutating requests, scoped per organization and actor.
create table idempotency_keys (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  key             text not null check (length(key) between 8 and 200),
  actor_id        uuid not null,
  request_hash    bytea not null check (octet_length(request_hash) = 32),
  response        jsonb,
  status_code     smallint,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, actor_id, key)
);
create index idempotency_keys_org_expires on idempotency_keys (organization_id, expires_at);
alter table idempotency_keys enable row level security;
alter table idempotency_keys force row level security;
create policy idempotency_keys_tenant_isolation on idempotency_keys for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on idempotency_keys to iam_app;
