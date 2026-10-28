-- 0017: index for per-actor, per-action counts over a sliding time window.
-- The reveal rate limit (ADR 0031) counts `credential.revealed` events of one actor in the last hour.
-- audit_events_org_actor (organization_id, actor_id, seq desc) would walk every event of the actor;
-- this index lets the count stop at the window boundary.
create index audit_events_org_actor_action_time
  on audit_events (organization_id, actor_id, action, created_at desc);
