-- 0026: permission to hand the invitation link to the person who invites (invitation-link task).
--
-- One new permission in the database catalog:
--   user.invite_link  -> ceiling 2  receive the invitation link in the response, to share it by hand
--                                   when the mail server fails. The API demands a recent re-authentication.
--
-- The rank ceiling trigger (0015) treats a permission that permission_rank_ceiling() does not know as a
-- violation (fail closed), so without this migration no role holding the new permission could be
-- assigned to anyone. This migration adds no table.
--
-- What this migration does:
--  1. Redefines permission_rank_ceiling() with ONE new line. CREATE OR REPLACE keeps the owner, the
--     revoke from public and the grant to iam_app of 0015; every other line is identical to the
--     definition of 0023, so no other permission changes its ceiling. permission-ceiling-sync.test.ts
--     reads this file (the latest definition) and compares it with PERMISSION_CEILING.
--  2. Grants the new permission to the live SYSTEM roles that hold user.invite (the templates give it
--     to the roles whose rank reaches ceiling 2: Root, Administrator and Leader), so
--     `sync-system-roles` finds nothing left to change afterwards.
--
-- What it does NOT do, on purpose:
--  * It does not touch custom roles: they never receive a permission without an explicit grant by a
--    person (least privilege).
--  * It does not touch archived roles, nor user_roles rows, so no assignment is revalidated.
--  * It writes no audit event: audit_events is a hash chain per organization that only the application
--    appends to. The change is traceable through this migration (applied once, checksummed) and through
--    the version column of each role, which goes up by one per role.
--
-- Row level security: roles has FORCE ROW LEVEL SECURITY and the migrator is NOSUPERUSER NOBYPASSRLS,
-- so without app.org_id an UPDATE would touch zero rows. Same pattern as 0023: FORCE is lifted and
-- restored inside this same transaction (the runner applies each file in one), so it is never off once
-- the migration ends.

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
    when 'user.invite_link' then 2
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
    when 'inbound.read_codes' then 3
    when 'inbound.configure' then 2
    when 'inbound.reveal_reset' then 1
  end::smallint
$$;

-- Idempotent: the last condition makes a second run (or a role already synced) a no-op.
alter table roles no force row level security;

update roles
   set permissions = array_append(permissions, 'user.invite_link'),
       version = version + 1
 where is_system
   and archived_at is null
   and 'user.invite' = any (permissions)
   and not ('user.invite_link' = any (permissions));

alter table roles force row level security;
