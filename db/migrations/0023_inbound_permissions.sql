-- 0023: permissions for reading codes that arrive by mail or SMS (ADR 0045, slice IC-2a).
--
-- Three new permissions in the database catalog:
--   inbound.read_codes    -> ceiling 3  see login codes and the reception history of a shared view
--   inbound.configure     -> ceiling 2  create sources and views and edit their template references
--   inbound.reveal_reset  -> ceiling 1  see reset codes and reset links (Root and Administrator only)
--
-- The rank ceiling trigger (0015) treats a permission that permission_rank_ceiling() does not know
-- as a violation (fail closed), so without this migration no role holding the new permissions could
-- be assigned to anyone. This migration is only the database side: it adds no table (IC-2b does).
--
-- What this migration does:
--  1. Redefines permission_rank_ceiling() with THREE new lines. CREATE OR REPLACE keeps the owner,
--     the revoke from public and the grant to iam_app of 0015; every other line is identical to the
--     definition of 0021, so no other permission changes its ceiling. The API duplicates the table
--     (PERMISSION_CEILING); permission-ceiling-sync.test.ts reads this file (the latest definition)
--     and compares both.
--  2. Grants the new permissions to the live SYSTEM roles that the code templates (SYSTEM_ROLES,
--     version 4) give them to, so `sync-system-roles` finds nothing left to change afterwards.
--     Each grant is keyed on a permission that marks the same ceiling, because the templates are
--     computed by ceiling:
--       inbound.read_codes   -> system roles holding credential.use_totp  (ceiling 3: all four)
--       inbound.configure    -> system roles holding account.archive      (ceiling 2: Root, Administrator, Leader)
--       inbound.reveal_reset -> system roles holding platform.manage      (ceiling 1: Root, Administrator)
--
-- What it does NOT do, on purpose:
--  * It does not touch custom roles: they never receive a permission without an explicit grant by a
--    person (least privilege). In particular nobody gets inbound.reveal_reset through a custom role
--    unless a person adds it from the roles screen, and the ceiling still caps who can hold it.
--  * It does not touch archived roles, nor user_roles rows, so no assignment is revalidated.
--  * It writes no audit event: audit_events is a hash chain per organization that only the
--    application appends to. The change is traceable through this migration (applied once,
--    checksummed) and through the version column of each role, which goes up by one per role.
--
-- Row level security: roles has FORCE ROW LEVEL SECURITY and the migrator is NOSUPERUSER
-- NOBYPASSRLS, so without app.org_id an UPDATE would touch zero rows. Same pattern as 0021: FORCE
-- is lifted and restored inside this same transaction (the runner applies each file in one), so it
-- is never off once the migration ends.

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
    when 'inbound.read_codes' then 3
    when 'inbound.configure' then 2
    when 'inbound.reveal_reset' then 1
  end::smallint
$$;

-- Each update is idempotent: the last condition makes a second run (or a role already synced) a
-- no-op, so the version of a role goes up once per permission actually added.
alter table roles no force row level security;

update roles
   set permissions = array_append(permissions, 'inbound.read_codes'),
       version = version + 1
 where is_system
   and archived_at is null
   and 'credential.use_totp' = any (permissions)
   and not ('inbound.read_codes' = any (permissions));

update roles
   set permissions = array_append(permissions, 'inbound.configure'),
       version = version + 1
 where is_system
   and archived_at is null
   and 'account.archive' = any (permissions)
   and not ('inbound.configure' = any (permissions));

update roles
   set permissions = array_append(permissions, 'inbound.reveal_reset'),
       version = version + 1
 where is_system
   and archived_at is null
   and 'platform.manage' = any (permissions)
   and not ('inbound.reveal_reset' = any (permissions));

alter table roles force row level security;
