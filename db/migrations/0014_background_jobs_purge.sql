-- 0014: background jobs traverse organizations, and expired ephemeral rows can be purged (ADR 0038).
--
-- A job runs outside any request, so app.org_id is unset and RLS hides every row. The jobs list
-- organization ids through ONE narrow function and then do everything per organization under normal
-- RLS (the caller sets app.org_id). Same mold as the 0008 functions:
--
--  * SECURITY DEFINER, owned by iam_auth_reader (NOLOGIN, no BYPASSRLS), which sees organizations
--    only through a dedicated `to iam_auth_reader` policy and holds SELECT on the id column only.
--  * No parameters, returns ids only: no names, slugs, status or settings.
--  * search_path fixed to pg_catalog and the table schema-qualified (CVE-2018-1058 class).
--  * EXECUTE revoked from PUBLIC and granted only to iam_app.

grant select (id) on organizations to iam_auth_reader;
create policy organizations_job_listing on organizations for select to iam_auth_reader using (true);

create function auth.list_organization_ids()
  returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select o.id from public.organizations o order by o.id
$$;
alter function auth.list_organization_ids() owner to iam_auth_reader;
revoke all on function auth.list_organization_ids() from public;
grant execute on function auth.list_organization_ids() to iam_app;

-- The purge deletes expired challenges per organization, under the tenant isolation policy (which
-- already covers DELETE: it is `for all`). idempotency_keys already grants DELETE since 0003.
grant delete on webauthn_challenges to iam_app;
create index webauthn_challenges_org_expires on webauthn_challenges (organization_id, expires_at);
