-- 0016: keyset listing of active accounts, ordered by name. The vault listing and the inventory
-- page through accounts by (lower(display_name), id); without this index each page sorts every
-- active account of the organization.
create index accounts_org_active_name on accounts (organization_id, lower(display_name), id)
  where status = 'active';

comment on index accounts_org_active_name is
  'Keyset order of the vault listing and inventory: active accounts by lower(display_name), id.';
