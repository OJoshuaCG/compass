import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, seedTenant, sha256, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('auth.* pre-authentication functions (no app.org_id set)', () => {
  it('login lookup returns only the columns needed, for exactly the matching email', async () => {
    const { rows, fields } = await app.query<Record<string, unknown>>(
      'select * from auth.find_login_by_email($1)',
      [a.rootEmail],
    );
    expect(fields.map((f) => f.name)).toEqual([
      'user_id',
      'organization_id',
      'status',
      'argon2_hash',
      'must_change',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: a.rootId,
      organization_id: a.orgId,
      status: 'active',
      must_change: false,
    });
    expect(String(rows[0]?.['argon2_hash'])).toMatch(/^\$argon2id\$/);
  });

  it('login lookup is case-insensitive and returns a null hash for users without password', async () => {
    const upper = await app.query('select * from auth.find_login_by_email($1)', [
      a.rootEmail.toUpperCase(),
    ]);
    expect(upper.rowCount).toBe(1);
    const noPassword = await app.query<{ argon2_hash: string | null }>(
      'select * from auth.find_login_by_email($1)',
      ['a-admin@example.test'],
    );
    expect(noPassword.rows[0]?.argon2_hash).toBeNull();
  });

  it('cannot be used to list or pattern-match other organizations', async () => {
    for (const probe of ['%', '%@example.test', "' or 1=1 --", '', 'a-root@example.test ']) {
      const { rowCount } = await app.query('select * from auth.find_login_by_email($1)', [probe]);
      expect(rowCount, JSON.stringify(probe)).toBe(0);
    }
    const nullProbe = await app.query('select * from auth.find_login_by_email(null)');
    expect(nullProbe.rowCount).toBe(0);
  });

  it('session lookup returns the minimum and never the token hash', async () => {
    const { rows, fields } = await app.query<Record<string, unknown>>(
      'select * from auth.find_session_by_token_hash($1)',
      [sha256(a.sessionToken)],
    );
    expect(fields.map((f) => f.name)).toEqual([
      'session_id',
      'organization_id',
      'user_id',
      'user_status',
      'expires_at',
      'revoked_at',
      'mfa_at',
      'reauth_at',
      'last_seen_at',
    ]);
    expect(rows[0]).toMatchObject({
      organization_id: a.orgId,
      user_id: a.rootId,
      user_status: 'active',
    });
    const unknown = await app.query('select * from auth.find_session_by_token_hash($1)', [
      sha256('nope'),
    ]);
    expect(unknown.rowCount).toBe(0);
  });

  it('invitation lookup returns the organization of that token only', async () => {
    const { rows, fields } = await app.query<Record<string, unknown>>(
      'select * from auth.find_invitation_by_token_hash($1)',
      [sha256(a.invitationToken)],
    );
    expect(fields.map((f) => f.name)).toEqual([
      'invitation_id',
      'organization_id',
      'email',
      'rank',
      'expires_at',
      'accepted_at',
      'revoked_at',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: a.orgId,
      email: 'a-invitee@example.test',
      rank: 2,
    });
  });

  it('handoff lookup never returns the encrypted payload', async () => {
    const { rows, fields } = await app.query<Record<string, unknown>>(
      'select * from auth.find_handoff_by_token_hash($1)',
      [sha256(b.handoffToken)],
    );
    expect(fields.map((f) => f.name)).toEqual([
      'handoff_id',
      'organization_id',
      'user_id',
      'credential_id',
      'status',
      'expires_at',
    ]);
    expect(rows[0]).toMatchObject({
      organization_id: b.orgId,
      user_id: b.rootId,
      status: 'pending',
    });
  });

  it('are SECURITY DEFINER with a fixed search_path, owned by a non-bypass role, executable only by iam_app', async () => {
    const { rows } = await admin.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      owner: string;
      bypass: boolean;
      pub: boolean;
      app: boolean;
    }>(`
      select p.proname, p.prosecdef, p.proconfig, r.rolname as owner, r.rolbypassrls as bypass,
             has_function_privilege('public', p.oid, 'EXECUTE') as pub,
             has_function_privilege('iam_app', p.oid, 'EXECUTE') as app
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'auth'
      join pg_roles r on r.oid = p.proowner
      where p.prorettype <> 'trigger'::regtype
      order by p.proname`);
    expect(rows.map((r) => r.proname)).toEqual([
      'find_handoff_by_token_hash',
      'find_invitation_by_token_hash',
      'find_login_by_email',
      'find_session_by_token_hash',
      'list_organization_ids',
      'resolve_inbound_address',
    ]);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.proconfig, r.proname).toContain('search_path=pg_catalog');
      expect(r.owner, r.proname).toBe('iam_auth_reader');
      expect(r.bypass, r.proname).toBe(false);
      expect(r.pub, r.proname).toBe(false);
      expect(r.app, r.proname).toBe(true);
    }
  });

  it('does not open direct access: tables stay empty for iam_app without a tenant and the definer role is unreachable', async () => {
    const { rows } = await app.query<{ n: string }>('select count(*)::text as n from sessions');
    expect(rows[0]?.n).toBe('0');
    expect(await sqlState(app, 'set role iam_auth_reader')).toBe('42501');
    // Column-level grants: the definer role cannot read secrets even if a function were abused.
    const priv = await admin.query<{ pw: boolean; payload: boolean; ciphertext: boolean }>(
      `select has_column_privilege('iam_auth_reader', 'public.totp_handoffs', 'payload_ciphertext', 'SELECT') as payload,
              has_column_privilege('iam_auth_reader', 'public.sessions', 'user_agent', 'SELECT') as pw,
              has_table_privilege('iam_auth_reader', 'public.credential_secrets', 'SELECT') as ciphertext`,
    );
    expect(priv.rows[0]).toEqual({ pw: false, payload: false, ciphertext: false });
  });
});
