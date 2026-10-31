-- 0014: purge of expired ephemeral rows (TODO G1, ADR 0038).
--
-- idempotency_keys and webauthn_challenges only matter until they expire, but nothing deleted
-- them. A background job has to walk the organizations to delete them under normal RLS (it sets
-- app.org_id per organization), and iam_app cannot list organizations: organizations_self_read
-- only shows the current one. auth.list_organization_ids() is the narrow, sanctioned way, with
-- the same mold as the pre-authentication functions of 0008:
--
--  * SECURITY DEFINER, owned by iam_auth_reader (NOLOGIN, no BYPASSRLS), SELECT on the id column
--    only and one dedicated `to iam_auth_reader` policy.
--  * Returns only organization ids. No names, slugs or settings. Takes no parameters.
--  * search_path fixed to pg_catalog and every table schema-qualified.
--  * EXECUTE revoked from PUBLIC and granted only to iam_app.
--  * Read-only: the job does the deletes under the normal tenant isolation policies.

grant select (id) on organizations to iam_auth_reader;
create policy organizations_auth_lookup on organizations for select to iam_auth_reader using (true);

create function auth.list_organization_ids()
  returns table (organization_id uuid)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select o.id
  from public.organizations o
  order by o.id
$$;

alter function auth.list_organization_ids() owner to iam_auth_reader;
revoke all on function auth.list_organization_ids() from public;
grant execute on function auth.list_organization_ids() to iam_app;

-- idempotency_keys already grants DELETE to iam_app (0003). Challenges did not: only the purge
-- deletes them, and the tenant isolation policy (for all) keeps it inside the current organization.
grant delete on webauthn_challenges to iam_app;
