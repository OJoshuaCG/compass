-- 0015: rank ceiling of each permission as a database invariant (TODO A2a, ADR 0012).
--
-- ADR 0012 says a role can only be assigned to a person whose rank is allowed to hold every
-- permission of that role (rank 0 = Root, a higher number means less authority). Until now only
-- the application enforced it (checkRoleAssignment), so any other writer, such as a script, a
-- future module or a bug, could store an assignment that the engine would then silently clip.
-- This migration makes the rule fail closed in the database as well.
--
-- Scope, on purpose narrow:
--  * Only INSERT and UPDATE OF user_id, role_id on user_roles. Editing the permissions of an
--    already assigned role, demoting a person and the subtree check are NOT covered here: they
--    depend on open business decisions (ADR 0008, open question 7).
--  * The trigger runs with the privileges of the caller (no SECURITY DEFINER), so it reads users
--    and roles under the normal tenant isolation policies and cannot see another organization.
--
-- The ceiling table duplicates PERMISSION_CEILING of the API (permission-catalog.ts). A unit test
-- in the API compares both so they cannot drift apart.

create function permission_rank_ceiling(permission text)
  returns smallint
  language sql immutable parallel safe
  set search_path = pg_catalog
as $$
  -- NULL for an unknown permission: the trigger below treats it as a violation.
  select case permission
    when 'org.settings' then 0
    when 'role.manage' then 1
    when 'platform.manage' then 1
    when 'vault.inventory.read' then 1
    when 'vault.emergency_access' then 1
    when 'audit.read_all' then 1
    when 'sso.clients.manage' then 1
    when 'user.invite' then 2
    when 'user.update' then 2
    when 'user.change_rank' then 1
    when 'user.transfer' then 2
    when 'user.deactivate' then 2
    when 'role.assign' then 2
    when 'group.create' then 2
    when 'group.manage_members' then 2
    when 'account.create' then 3
    when 'account.update' then 3
    when 'account.archive' then 2
    when 'credential.create' then 3
    when 'credential.update' then 3
    when 'credential.reveal_password' then 3
    when 'credential.use_totp' then 3
    when 'credential.export_totp' then 2
    when 'share.manage' then 3
    when 'access_request.approve' then 2
    when 'rotation.manage' then 2
    when 'audit.read_scope' then 2
  end::smallint
$$;

revoke all on function permission_rank_ceiling(text) from public;
grant execute on function permission_rank_ceiling(text) to iam_app;

-- user_roles_enforce_rank_ceiling()
--  * Purpose: reject a user_roles row whose role holds a permission that the rank of the user
--    is not allowed to have (ceiling), or a permission that is not in the catalog.
--  * Parameters: none (trigger function; reads NEW).
--  * Side effects: none, it only reads users and roles of the same organization. It raises
--    SQLSTATE 23514 (constraint user_roles_rank_ceiling) on violation.
--  * Transactions: runs inside the statement's transaction; the error aborts it.
--  * Fail closed: a missing user or role (for example hidden by tenant isolation) is also a
--    violation. The composite foreign keys would reject it later, but this trigger must not
--    depend on them.
create function user_roles_enforce_rank_ceiling()
  returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
declare
  target_rank smallint;
  role_permissions text[];
  offending_permission text;
begin
  select u.rank
    into target_rank
  from public.users u
  where u.organization_id = new.organization_id
    and u.id = new.user_id;

  if not found then
    raise exception 'user not found for the rank ceiling check'
      using errcode = '23514', constraint = 'user_roles_rank_ceiling';
  end if;

  select r.permissions
    into role_permissions
  from public.roles r
  where r.organization_id = new.organization_id
    and r.id = new.role_id;

  if not found then
    raise exception 'role not found for the rank ceiling check'
      using errcode = '23514', constraint = 'user_roles_rank_ceiling';
  end if;

  select role_permission
    into offending_permission
  from unnest(role_permissions) as role_permission
  where public.permission_rank_ceiling(role_permission) is null
    or target_rank > public.permission_rank_ceiling(role_permission)
  order by role_permission
  limit 1;

  if offending_permission is not null then
    -- The permission name is a catalog value, never user data, so it is safe in the message.
    raise exception 'role permission % exceeds the rank ceiling of the user', offending_permission
      using errcode = '23514', constraint = 'user_roles_rank_ceiling';
  end if;

  return new;
end
$$;

revoke all on function user_roles_enforce_rank_ceiling() from public;

create trigger user_roles_rank_ceiling
  before insert or update of user_id, role_id on user_roles
  for each row execute function user_roles_enforce_rank_ceiling();
