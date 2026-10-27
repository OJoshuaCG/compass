-- 0007: effective_access. Listings join this view so authorization filters in SQL and never
-- in memory (plan "Motor de decisión").
--
-- security_invoker = true: the view runs with the caller's privileges, so RLS of shares,
-- groups and group_memberships still applies. Without it the view would run as its owner
-- and the FORCE'd policies would evaluate against the owner, not the tenant.

create function share_level_rank(p_level text) returns smallint
  language sql immutable parallel safe strict
  set search_path = pg_catalog
as $$
  select case p_level when 'USE' then 1 when 'VIEW' then 2 when 'EDIT' then 3 when 'MANAGE' then 4 end::smallint
$$;
grant execute on function share_level_rank(text) to iam_app;

create view effective_access with (security_invoker = true) as
with expanded as (
  select s.organization_id, s.resource_type, s.resource_id, s.grantee_id as user_id,
         s.level, 'direct'::text as source
  from shares s
  where s.grantee_type = 'user'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  union all
  select s.organization_id, s.resource_type, s.resource_id, gm.user_id,
         s.level, 'group'::text as source
  from shares s
  join groups g
    on g.organization_id = s.organization_id and g.id = s.grantee_id and g.archived_at is null
  join group_memberships gm
    on gm.organization_id = s.organization_id and gm.group_id = g.id
  where s.grantee_type = 'group'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
)
select
  organization_id,
  resource_type,
  resource_id,
  user_id,
  -- The effective level is the maximum between direct and inherited grants.
  (array['USE', 'VIEW', 'EDIT', 'MANAGE'])[max(share_level_rank(level))] as level,
  array_agg(distinct source order by source) as sources
from expanded
group by organization_id, resource_type, resource_id, user_id;

grant select on effective_access to iam_app;
