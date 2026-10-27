-- 0008: pre-authentication access (schema auth).
--
-- Login by email, invitation token, handoff token and session lookup happen BEFORE the
-- organization is known, so app.org_id is unset and RLS returns zero rows by design. These
-- four functions are the only sanctioned way around that, and they are deliberately narrow:
--
--  * SECURITY DEFINER, owned by iam_auth_reader: a NOLOGIN role with NO BYPASSRLS. It sees
--    rows only through a dedicated `to iam_auth_reader` policy per table and holds SELECT on
--    just the columns each function returns. Compromising a function cannot reach other columns.
--  * Lookup by a single exact key (email or SHA-256 token hash): never a listing, never a scan
--    parameter. No function takes an organization id.
--  * search_path fixed to pg_catalog and every table schema-qualified (CVE-2018-1058 class).
--  * EXECUTE revoked from PUBLIC and granted only to iam_app.
--  * Read-only: after the lookup the caller sets app.org_id from the returned organization_id
--    and does all further work under normal RLS.

-- Column-level grants for the definer role.
grant select (id, organization_id, email, status) on users to iam_auth_reader;
grant select (organization_id, user_id, argon2_hash, must_change) on user_passwords to iam_auth_reader;
grant select (id, organization_id, user_id, token_hash, expires_at, revoked_at, mfa_at, reauth_at, last_seen_at)
  on sessions to iam_auth_reader;
grant select (id, organization_id, email, rank, token_hash, expires_at, accepted_at, revoked_at)
  on invitations to iam_auth_reader;
grant select (id, organization_id, user_id, credential_id, token_hash, status, expires_at)
  on totp_handoffs to iam_auth_reader;

create policy users_auth_lookup on users for select to iam_auth_reader using (true);
create policy user_passwords_auth_lookup on user_passwords for select to iam_auth_reader using (true);
create policy sessions_auth_lookup on sessions for select to iam_auth_reader using (true);
create policy invitations_auth_lookup on invitations for select to iam_auth_reader using (true);
create policy totp_handoffs_auth_lookup on totp_handoffs for select to iam_auth_reader using (true);

-- Login: email -> who, which organization, and the hash to verify. The password hash must be
-- returned (Argon2id verification happens in the application); it is NULL for users who have
-- not set a password yet. Callers must return identical errors for "no row" and "bad password".
create function auth.find_login_by_email(p_email text)
  returns table (user_id uuid, organization_id uuid, status text, argon2_hash text, must_change boolean)
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select u.id, u.organization_id, u.status, p.argon2_hash, p.must_change
  from public.users u
  left join public.user_passwords p
    on p.organization_id = u.organization_id and p.user_id = u.id
  where u.email = lower(p_email)
$$;

-- Session lookup by SHA-256 of the cookie token. user_status lets the caller reject sessions of
-- suspended or deactivated users without a second pre-auth query. token_hash is not returned.
create function auth.find_session_by_token_hash(p_token_hash bytea)
  returns table (
    session_id uuid, organization_id uuid, user_id uuid, user_status text,
    expires_at timestamptz, revoked_at timestamptz, mfa_at timestamptz,
    reauth_at timestamptz, last_seen_at timestamptz
  )
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select s.id, s.organization_id, s.user_id, u.status,
         s.expires_at, s.revoked_at, s.mfa_at, s.reauth_at, s.last_seen_at
  from public.sessions s
  join public.users u on u.organization_id = s.organization_id and u.id = s.user_id
  where s.token_hash = p_token_hash
$$;

-- Invitation lookup by token hash; accepted/revoked/expired rows are returned so the caller can
-- give a precise (but non-enumerating) refusal.
create function auth.find_invitation_by_token_hash(p_token_hash bytea)
  returns table (
    invitation_id uuid, organization_id uuid, email text, rank smallint,
    expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz
  )
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select i.id, i.organization_id, i.email, i.rank, i.expires_at, i.accepted_at, i.revoked_at
  from public.invitations i
  where i.token_hash = p_token_hash
$$;

-- Handoff lookup for the unauthenticated phone page. payload_ciphertext is NOT returned.
create function auth.find_handoff_by_token_hash(p_token_hash bytea)
  returns table (
    handoff_id uuid, organization_id uuid, user_id uuid, credential_id uuid,
    status text, expires_at timestamptz
  )
  language sql stable security definer
  set search_path = pg_catalog
as $$
  select h.id, h.organization_id, h.user_id, h.credential_id, h.status, h.expires_at
  from public.totp_handoffs h
  where h.token_hash = p_token_hash
$$;

alter function auth.find_login_by_email(text) owner to iam_auth_reader;
alter function auth.find_session_by_token_hash(bytea) owner to iam_auth_reader;
alter function auth.find_invitation_by_token_hash(bytea) owner to iam_auth_reader;
alter function auth.find_handoff_by_token_hash(bytea) owner to iam_auth_reader;

revoke all on function auth.find_login_by_email(text) from public;
revoke all on function auth.find_session_by_token_hash(bytea) from public;
revoke all on function auth.find_invitation_by_token_hash(bytea) from public;
revoke all on function auth.find_handoff_by_token_hash(bytea) from public;
grant execute on function auth.find_login_by_email(text) to iam_app;
grant execute on function auth.find_session_by_token_hash(bytea) to iam_app;
grant execute on function auth.find_invitation_by_token_hash(bytea) to iam_app;
grant execute on function auth.find_handoff_by_token_hash(bytea) to iam_app;
