-- 0004: directory (groups) and access (roles). Permissions live in code (a versioned enum);
-- roles only store the permission names granted.

create table groups (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  name            text not null check (length(btrim(name)) between 1 and 200),
  description     text,
  created_by      uuid not null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id)
);
create unique index groups_org_name_live on groups (organization_id, lower(name)) where archived_at is null;
create index groups_org_created_by on groups (organization_id, created_by);
create trigger groups_touch before update on groups for each row execute function touch_updated_at();
alter table groups enable row level security;
alter table groups force row level security;
create policy groups_tenant_isolation on groups for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on groups to iam_app;

-- group_memberships: relation rows. Removing a member deletes the row (DeactivateUser takes
-- the user out of every group); the audit trail is the history of who was a member when.
create table group_memberships (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  group_id        uuid not null,
  user_id         uuid not null,
  role            text not null check (role in ('manager', 'member')),
  added_by        uuid not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, group_id, user_id),
  foreign key (organization_id, group_id) references groups (organization_id, id),
  foreign key (organization_id, user_id) references users (organization_id, id),
  foreign key (organization_id, added_by) references users (organization_id, id)
);
create index group_memberships_org_user on group_memberships (organization_id, user_id);
alter table group_memberships enable row level security;
alter table group_memberships force row level security;
create policy group_memberships_tenant_isolation on group_memberships for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on group_memberships to iam_app;

create table roles (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  name            text not null check (length(btrim(name)) between 1 and 100),
  is_system       boolean not null default false,
  permissions     text[] not null default '{}',
  created_by      uuid,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, created_by) references users (organization_id, id),
  -- System templates are seeded by the platform, custom roles always have an author.
  constraint roles_custom_has_author check (is_system or created_by is not null)
);
create unique index roles_org_name_live on roles (organization_id, lower(name)) where archived_at is null;
create trigger roles_touch before update on roles for each row execute function touch_updated_at();
alter table roles enable row level security;
alter table roles force row level security;
create policy roles_tenant_isolation on roles for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update on roles to iam_app;

create table user_roles (
  id              uuid primary key default uuid_generate_v7(),
  organization_id uuid not null references organizations (id),
  user_id         uuid not null,
  role_id         uuid not null,
  granted_by      uuid not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id, role_id),
  foreign key (organization_id, user_id) references users (organization_id, id),
  foreign key (organization_id, role_id) references roles (organization_id, id),
  foreign key (organization_id, granted_by) references users (organization_id, id)
);
create index user_roles_org_role on user_roles (organization_id, role_id);
alter table user_roles enable row level security;
alter table user_roles force row level security;
create policy user_roles_tenant_isolation on user_roles for all
  using (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, update, delete on user_roles to iam_app;
