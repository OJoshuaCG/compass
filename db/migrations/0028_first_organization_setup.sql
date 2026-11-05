-- 0028: creation of the first organization from the one-time setup link (ADR 0046).
--
-- organizations has no INSERT policy for anyone (0002): organizations were created only by an
-- operations script with a connection that bypasses RLS. The setup link has to create the first
-- one from the API, which connects as iam_app, so it gets a single narrow door with the same mold
-- as the pre-authentication functions of 0008 and 0014:
--
--  * SECURITY DEFINER, owned by iam_auth_reader (NOLOGIN, no BYPASSRLS). The role gets INSERT on
--    (id, name, slug) only and one dedicated `to iam_auth_reader` INSERT policy. The role cannot be
--    reached by anyone: iam_app cannot SET ROLE to it, so the grant is usable only through the function.
--  * The function refuses to run when ANY organization exists (SQLSTATE IAM01). That check is the
--    database-side half of "the link works only once": it holds even if the application layer
--    forgets to check, and the advisory lock makes two concurrent calls resolve to one winner.
--  * It creates only the organization row. Roles, the Root user, credentials, recovery codes and
--    the audit event are inserted afterwards by the API in the same transaction under the normal
--    tenant isolation policies (app.org_id), so no other table gets a new privilege.
--  * search_path fixed to pg_catalog and every table schema-qualified. EXECUTE revoked from PUBLIC
--    and granted only to iam_app.

grant insert (id, name, slug) on organizations to iam_auth_reader;
create policy organizations_first_setup_insert on organizations
  for insert to iam_auth_reader with check (true);

create function auth.create_first_organization(p_organization_id uuid, p_name text, p_slug text)
  returns void
  language plpgsql security definer
  set search_path = pg_catalog
as $$
begin
  -- Serializes concurrent calls: the second one waits, then sees the organization the first created.
  perform pg_advisory_xact_lock(hashtextextended('iam:first-organization', 0));
  if exists (select 1 from public.organizations) then
    raise exception 'the first organization already exists' using errcode = 'IAM01';
  end if;
  insert into public.organizations (id, name, slug) values (p_organization_id, p_name, p_slug);
end;
$$;

alter function auth.create_first_organization(uuid, text, text) owner to iam_auth_reader;
revoke all on function auth.create_first_organization(uuid, text, text) from public;
grant execute on function auth.create_first_organization(uuid, text, text) to iam_app;
