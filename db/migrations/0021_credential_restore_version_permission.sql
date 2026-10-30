-- 0021: new permission credential.restore_version in the database catalog (ceiling 3).
--
-- Restoring a previous password version used to require credential.update (the permission to
-- change the password). The owner asked for a dedicated permission so it can be granted or
-- withheld on its own; the two-judge panel recommended it unanimously. This is the database side:
-- the rank ceiling trigger (0015) treats a permission that permission_rank_ceiling() does not know
-- as a violation (fail closed), so without this migration no role holding the new permission could
-- be assigned to anyone.
--
-- What this migration does:
--  1. Redefines permission_rank_ceiling() with ONE new line: credential.restore_version -> 3, the
--     same ceiling as credential.update, so an Operator-rank person can hold it just like today.
--     CREATE OR REPLACE keeps the owner, the revoke from public and the grant to iam_app of 0015;
--     the function body is otherwise identical, so every other permission keeps its ceiling.
--     The ceiling table is still duplicated in PERMISSION_CEILING of the API; the sync unit test
--     now reads this file (the latest definition of the function) and compares both.
--  2. Grants the new permission to every live SYSTEM role that already holds credential.update, so
--     the behavior that exists today (whoever could restore keeps being able to) does not break.
--     The code templates (SYSTEM_ROLES, version 3) give it to the same four system roles, so the
--     `sync-system-roles` command finds nothing left to change afterwards.
--
-- What it does NOT do, on purpose:
--  * It does not touch custom roles: they never receive a permission without an explicit grant by
--    a person (least privilege). A custom role that holds credential.update loses the ability to
--    restore until someone adds the new permission to it from the roles screen.
--  * It does not touch archived roles, nor user_roles rows, so no assignment is revalidated.
--  * It writes no audit event: the rows of audit_events belong to a hash chain per organization
--    that only the application appends to. The change is traceable through this migration (applied
--    once, checksummed) and through the version column of each role, which goes up by one.
--
-- Row level security: roles has FORCE ROW LEVEL SECURITY and the migrator is NOSUPERUSER
-- NOBYPASSRLS, so without app.org_id an UPDATE would touch zero rows. Same pattern as the seed of
-- 0005 (see docs/database.md): FORCE is lifted and restored inside this same transaction (the
-- runner applies each file in one), so it is never off once the migration ends.

create or replace function permission_rank_ceiling(permission text)
  returns smallint
  language sql immutable parallel safe
  set search_path = pg_catalog
as $$
  -- NULL for an unknown permission: the trigger of 0015 treats it as a violation.
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
    when 'credential.restore_version' then 3
    when 'credential.reveal_password' then 3
    when 'credential.use_totp' then 3
    when 'credential.export_totp' then 2
    when 'share.manage' then 3
    when 'access_request.approve' then 2
    when 'rotation.manage' then 2
    when 'audit.read_scope' then 2
  end::smallint
$$;

-- Grant to the live system roles that hold credential.update. Idempotent: the last condition makes
-- a second run (or a role already synced) a no-op, so the version of a role goes up only once.
alter table roles no force row level security;
update roles
   set permissions = array_append(permissions, 'credential.restore_version'),
       version = version + 1
 where is_system
   and archived_at is null
   and 'credential.update' = any (permissions)
   and not ('credential.restore_version' = any (permissions));
alter table roles force row level security;
