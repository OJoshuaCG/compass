-- 0001: base layer shared by every later migration.
--
-- Roles are cluster-level objects, so they are NOT created here: migrations run as
-- iam_migrator, which has no CREATEROLE. `bootstrapRoles()` (db/src/bootstrap.ts) provisions
-- them once per cluster with an admin connection. This migration only verifies them, so a
-- missing role fails early with an actionable message instead of at the first GRANT.

do $$
declare
  v_missing text[];
begin
  select array_agg(r) into v_missing
  from unnest(array['iam_migrator', 'iam_app', 'iam_auth_reader']) as r
  where not exists (select 1 from pg_roles where rolname = r);

  if v_missing is not null then
    raise exception 'missing database roles: %. Run the bootstrap step (db/src/bootstrap.ts) with an admin connection first.', v_missing;
  end if;

  if exists (select 1 from pg_roles where rolname = 'iam_app' and (rolbypassrls or rolsuper)) then
    raise exception 'iam_app must not have BYPASSRLS or SUPERUSER';
  end if;
end
$$;

-- The auth schema holds the minimal SECURITY DEFINER functions used before the organization
-- is known (see 0008). Nothing else lives there.
create schema auth;
revoke all on schema auth from public;
grant usage on schema auth to iam_app;
-- iam_auth_reader must own the functions, and ownership transfer requires CREATE on the schema.
grant create, usage on schema auth to iam_auth_reader;

-- PostgreSQL 17 has no native UUIDv7 (it arrives in 18). 48-bit unix-ms timestamp followed by
-- random bits; the version nibble is flipped from 4 to 7 by setting bits 52 and 53.
-- Time-ordered ids keep B-tree inserts local and do not expose row counts.
create function uuid_generate_v7() returns uuid
  language sql volatile parallel safe
  set search_path = pg_catalog
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;

grant execute on function uuid_generate_v7() to iam_app;

-- Keeps updated_at honest without trusting the application. `version` is NOT bumped here:
-- optimistic concurrency (If-Match) is driven explicitly by the repositories.
create function touch_updated_at() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

-- CREATE on public is revoked from PUBLIC so no role can plant objects that shadow ours.
revoke create on schema public from public;
