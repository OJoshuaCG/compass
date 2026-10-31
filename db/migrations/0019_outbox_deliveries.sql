-- Delivery receipts for outbox handlers (ADR 0035, R2a). The worker delivers events AT LEAST once, so a
-- handler with an external effect (an email) needs a durable "already done" mark that survives the rollback of
-- the worker transaction. The handler commits this row on an independent connection right after the effect
-- succeeded; if the worker transaction later fails or times out, the retry finds the row and skips the effect.
--
-- There is deliberately NO foreign key to outbox_events: the worker holds a FOR UPDATE lock on the event row
-- while the handler runs, and the insert here happens on another connection. A foreign key would wait for that
-- very lock and deadlock the handler against its own worker transaction.

create table outbox_deliveries (
  organization_id uuid not null references organizations (id),
  -- Id of the outbox event (UUIDv7). It is the idempotency key of the delivery.
  event_id        uuid not null,
  -- Stable name of the handler whose effect was delivered, so two handlers of one event do not mask each other.
  handler_key     text not null check (char_length(handler_key) between 1 and 100),
  delivered_at    timestamptz not null default now(),
  primary key (organization_id, event_id, handler_key)
);
comment on table outbox_deliveries is 'Receipts of effects already delivered by outbox handlers; makes at-least-once delivery idempotent.';
comment on column outbox_deliveries.event_id is 'Id of the outbox event whose effect was delivered (no foreign key on purpose: see the migration header).';
comment on column outbox_deliveries.handler_key is 'Stable name of the handler that delivered the effect.';

alter table outbox_deliveries enable row level security;
alter table outbox_deliveries force row level security;
create policy outbox_deliveries_tenant_isolation on outbox_deliveries for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
-- Receipts are never edited. Deleting is left out until the retention of published events (G1) is decided.
grant select, insert on outbox_deliveries to iam_app;
