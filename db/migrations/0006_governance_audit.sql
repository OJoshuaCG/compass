-- 0006: governance (access requests, rotation tasks), audit and TOTP handoffs.

create table access_requests (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  requester_id    uuid not null,
  account_id      uuid not null,
  level           text not null check (level in ('USE', 'VIEW', 'EDIT', 'MANAGE')),
  reason          text not null check (length(btrim(reason)) > 0),
  duration        interval not null check (duration > interval '0'),
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'denied', 'cancelled', 'expired')),
  decided_by      uuid,
  decided_at      timestamptz,
  share_id        uuid,  -- the time-boxed share created on approval
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, requester_id) references users (organization_id, id),
  foreign key (organization_id, account_id) references accounts (organization_id, id),
  foreign key (organization_id, decided_by) references users (organization_id, id),
  foreign key (organization_id, share_id) references shares (organization_id, id),
  constraint access_requests_decision_consistent
    check ((status in ('approved', 'denied')) = (decided_by is not null and decided_at is not null))
);
create index access_requests_org_requester on access_requests (organization_id, requester_id);
create index access_requests_org_account_status on access_requests (organization_id, account_id, status);
create trigger access_requests_touch before update on access_requests for each row execute function touch_updated_at();
alter table access_requests enable row level security;
alter table access_requests force row level security;
create policy access_requests_tenant_isolation on access_requests for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on access_requests to iam_app;

create table rotation_tasks (
  id                 uuid primary key default uuid_generate_v7(),
  organization_id    uuid not null references organizations (id),
  credential_id      uuid not null,
  trigger            text not null
                     check (trigger in ('user_deactivated', 'share_revoked', 'totp_exported', 'manual', 'age_policy')),
  triggered_by_user  uuid,
  assigned_to        uuid not null,
  priority           text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status             text not null default 'pending'
                     check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  due_at             timestamptz not null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (organization_id, credential_id) references credentials (organization_id, id),
  foreign key (organization_id, triggered_by_user) references users (organization_id, id),
  foreign key (organization_id, assigned_to) references users (organization_id, id),
  constraint rotation_tasks_done_consistent check ((status = 'done') = (completed_at is not null))
);
create index rotation_tasks_org_assignee_status on rotation_tasks (organization_id, assigned_to, status);
create index rotation_tasks_org_credential on rotation_tasks (organization_id, credential_id);
create index rotation_tasks_org_due on rotation_tasks (organization_id, due_at) where status in ('pending', 'in_progress');
create trigger rotation_tasks_touch before update on rotation_tasks for each row execute function touch_updated_at();
alter table rotation_tasks enable row level security;
alter table rotation_tasks force row level security;
create policy rotation_tasks_tenant_isolation on rotation_tasks for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on rotation_tasks to iam_app;

-- totp_handoffs: phone-to-desktop 2FA enrolment. Only the SHA-256 of the one-use token is
-- stored. The URI sent by the phone is held encrypted until the desktop user confirms.
create table totp_handoffs (
  id                  uuid primary key default uuid_generate_v7(),
  organization_id     uuid not null references organizations (id),
  user_id             uuid not null,
  credential_id       uuid not null,
  token_hash          bytea not null unique check (octet_length(token_hash) = 32),
  status              text not null default 'pending'
                      check (status in ('pending', 'received', 'confirmed', 'expired', 'cancelled')),
  expires_at          timestamptz not null,
  payload_ciphertext  bytea,
  payload_nonce       bytea check (payload_nonce is null or octet_length(payload_nonce) = 12),
  payload_dek_version integer check (payload_dek_version is null or payload_dek_version > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (organization_id, user_id) references users (organization_id, id),
  foreign key (organization_id, credential_id) references credentials (organization_id, id),
  constraint totp_handoffs_payload_complete
    check ((payload_ciphertext is null) = (payload_nonce is null)
       and (payload_ciphertext is null) = (payload_dek_version is null))
);
create index totp_handoffs_org_user on totp_handoffs (organization_id, user_id);
create index totp_handoffs_org_expires on totp_handoffs (organization_id, expires_at);
create trigger totp_handoffs_touch before update on totp_handoffs for each row execute function touch_updated_at();
alter table totp_handoffs enable row level security;
alter table totp_handoffs force row level security;
create policy totp_handoffs_tenant_isolation on totp_handoffs for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Ephemeral (5 minute TTL): expired rows may be purged.
grant select, insert, update, delete on totp_handoffs to iam_app;

-- audit_events --------------------------------------------------------------------------
-- Append-only and hash-chained per organization. The database, not the application, assigns
-- seq / prev_hash / hash / created_at in a BEFORE INSERT trigger (values sent by the client
-- are overwritten), so a buggy or compromised caller cannot fork or forge the chain.
--
-- Concurrency: the trigger takes a transaction-scoped advisory lock per organization, so
-- two concurrent writers cannot read the same "previous" row. The lock is held until COMMIT;
-- write the audit event as the LAST statement of a transaction (see docs/database.md).
--
-- Hash = sha256(utf8(jsonb_build_array(...)::text)): a JSON array is an unambiguous encoding
-- (no separator collisions), and jsonb text output is canonical (sorted keys, fixed spacing).
create table audit_events (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  seq             bigint not null,
  actor_id        uuid,  -- NULL for system and pre-authentication events
  action          text not null check (length(action) between 1 and 100),
  target_type     text,
  target_id       uuid,
  outcome         text not null check (outcome in ('success', 'denied', 'failure')),
  reason_code     text,
  ip              inet,
  request_id      text,
  metadata        jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  prev_hash       bytea not null default '\x'::bytea,
  hash            bytea not null default '\x'::bytea,
  created_at      timestamptz not null default now(),
  unique (organization_id, seq),
  foreign key (organization_id, actor_id) references users (organization_id, id)
);
create index audit_events_org_target on audit_events (organization_id, target_type, target_id, seq desc);
create index audit_events_org_actor on audit_events (organization_id, actor_id, seq desc);
create index audit_events_org_action on audit_events (organization_id, action, seq desc);
create index audit_events_org_request on audit_events (organization_id, request_id) where request_id is not null;

create function audit_event_hash(
  p_prev_hash bytea, p_organization_id uuid, p_seq bigint, p_id uuid, p_created_at timestamptz,
  p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid, p_outcome text,
  p_reason_code text, p_ip inet, p_request_id text, p_metadata jsonb
) returns bytea
  language sql immutable
  set search_path = pg_catalog
as $$
  select sha256(convert_to(
    jsonb_build_array(
      encode(p_prev_hash, 'hex'), p_organization_id, p_seq, p_id,
      -- microseconds since epoch: independent of the session TimeZone setting
      floor(extract(epoch from p_created_at) * 1000000)::bigint,
      p_actor_id, p_action, p_target_type, p_target_id, p_outcome, p_reason_code,
      host(p_ip), p_request_id, p_metadata
    )::text,
    'UTF8'
  ))
$$;

create function audit_events_chain() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_prev_hash bytea;
  v_prev_seq  bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('audit_events:' || new.organization_id::text, 0));

  select e.hash, e.seq into v_prev_hash, v_prev_seq
  from public.audit_events e
  where e.organization_id = new.organization_id
  order by e.seq desc
  limit 1;

  new.seq        := coalesce(v_prev_seq, 0) + 1;
  -- Genesis: 32 zero bytes.
  new.prev_hash  := coalesce(v_prev_hash, decode(repeat('00', 32), 'hex'));
  new.created_at := clock_timestamp();
  new.hash       := public.audit_event_hash(
    new.prev_hash, new.organization_id, new.seq, new.id, new.created_at, new.actor_id,
    new.action, new.target_type, new.target_id, new.outcome, new.reason_code, new.ip,
    new.request_id, new.metadata
  );
  return new;
end
$$;
create trigger audit_events_chain before insert on audit_events
  for each row execute function audit_events_chain();

-- Defense in depth: even a role that holds UPDATE/DELETE (the owner) cannot rewrite history.
create function audit_events_reject_change() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception 'audit_events is append-only (% rejected)', tg_op using errcode = '42501';
end
$$;
create trigger audit_events_no_update_delete before update or delete on audit_events
  for each row execute function audit_events_reject_change();
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function audit_events_reject_change();

-- Returns the seq of the first event that breaks the chain of the CURRENT organization
-- (app.org_id), or NULL when the chain is intact. Called by the daily verification job.
-- Limit: deleting the newest events is undetectable here; the external immutable export
-- (S3 Object Lock) is what anchors the tail.
create function audit_verify_chain() returns bigint
  language sql stable
  set search_path = pg_catalog, public
as $$
  select min(t.seq)
  from (
    select
      e.seq, e.prev_hash, e.hash,
      lag(e.hash) over w as expected_prev_hash,
      lag(e.seq)  over w as expected_prev_seq,
      public.audit_event_hash(
        e.prev_hash, e.organization_id, e.seq, e.id, e.created_at, e.actor_id, e.action,
        e.target_type, e.target_id, e.outcome, e.reason_code, e.ip, e.request_id, e.metadata
      ) as recomputed
    from public.audit_events e
    where e.organization_id = nullif(current_setting('app.org_id', true), '')::uuid
    window w as (order by e.seq)
  ) t
  where t.hash is distinct from t.recomputed
     or t.prev_hash is distinct from coalesce(t.expected_prev_hash, decode(repeat('00', 32), 'hex'))
     or t.seq is distinct from coalesce(t.expected_prev_seq, 0) + 1
$$;
grant execute on function audit_verify_chain() to iam_app;

alter table audit_events enable row level security;
alter table audit_events force row level security;
-- Two policies only: there is no UPDATE or DELETE policy, so those commands match no rows
-- for any role subject to RLS.
create policy audit_events_read on audit_events for select
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy audit_events_insert on audit_events for insert
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert on audit_events to iam_app;
revoke update, delete, truncate on audit_events from iam_app;
revoke update, delete, truncate on audit_events from public;
-- The owner granted itself everything at CREATE; take history-rewriting rights back.
revoke update, delete, truncate on audit_events from current_user;
