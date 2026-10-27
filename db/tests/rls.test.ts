import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

const PHASE1_TENANT_TABLES = [
  'users',
  'user_passwords',
  'webauthn_credentials',
  'webauthn_challenges',
  'user_totp_factors',
  'user_recovery_codes',
  'sessions',
  'invitations',
  'groups',
  'group_memberships',
  'roles',
  'user_roles',
  'platforms',
  'accounts',
  'credentials',
  'credential_secrets',
  'shares',
  'password_fingerprints',
  'access_requests',
  'rotation_tasks',
  'audit_events',
  'totp_handoffs',
  'data_keys',
  'outbox_events',
  'idempotency_keys',
];

let adminUrl = '';
let appUrl = '';
let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;
let tenantTables: string[] = [];

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  adminUrl = db.adminUrl;
  appUrl = db.appUrl;
  a = await seedTenant(appUrl, adminUrl, 'a');
  b = await seedTenant(appUrl, adminUrl, 'b');
  admin = await connect(adminUrl);
  app = await connect(appUrl);
  // Discovered dynamically so a table added later without RLS fails this suite.
  const { rows } = await admin.query<{ relname: string }>(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute at on at.attrelid = c.oid and at.attname = 'organization_id' and not at.attisdropped
    where c.relkind in ('r', 'p')
    order by c.relname`);
  tenantTables = rows.map((r) => r.relname);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('RLS structure (every table with organization_id)', () => {
  it('discovers every phase-1 tenant table', () => {
    expect(tenantTables.filter((t) => t !== 'schema_migrations')).toEqual(
      [...PHASE1_TENANT_TABLES].sort(),
    );
  });

  it('has RLS enabled and forced, at least one policy and an organization_id-first index', async () => {
    for (const table of tenantTables) {
      const flags = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        'select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass',
        [`public.${table}`],
      );
      expect(flags.rows[0]?.relrowsecurity, `${table} RLS enabled`).toBe(true);
      expect(flags.rows[0]?.relforcerowsecurity, `${table} RLS forced`).toBe(true);

      const policies = await admin.query(
        "select 1 from pg_policies where schemaname = 'public' and tablename = $1",
        [table],
      );
      expect(policies.rowCount, `${table} policies`).toBeGreaterThanOrEqual(1);

      const idx = await admin.query(
        `select 1
         from pg_index i
         join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
         where i.indrelid = $1::regclass and at.attname = 'organization_id'`,
        [`public.${table}`],
      );
      expect(idx.rowCount, `${table} index starting with organization_id`).toBeGreaterThanOrEqual(
        1,
      );
    }
  });

  it('also protects organizations itself', async () => {
    const { rows } = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.organizations'::regclass",
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe('fail closed without app.org_id', () => {
  it('returns zero tenant rows from every table', async () => {
    for (const table of tenantTables) {
      const { rows } = await app.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      expect(rows[0]?.n, table).toBe('0');
    }
    const orgs = await app.query<{ n: string }>('select count(*)::text as n from organizations');
    expect(orgs.rows[0]?.n).toBe('0');
  });

  it('still returns zero rows (not an error) after SET LOCAL ended on a reused connection', async () => {
    await inOrg(app, a.orgId, () => app.query('select 1'));
    const { rows } = await app.query<{ n: string }>('select count(*)::text as n from users');
    expect(rows[0]?.n).toBe('0');
  });

  it('rejects writes without app.org_id', async () => {
    const state = await sqlState(
      app,
      "insert into groups (organization_id, name, created_by) values ($1, 'x', $2)",
      [a.orgId, a.rootId],
    );
    expect(state).toBe('42501');
  });
});

describe('two-organization isolation (connected as iam_app)', () => {
  it('A only sees and counts its own rows in every table', async () => {
    for (const table of tenantTables) {
      const visible = await inOrg(app, a.orgId, () =>
        app.query<{ total: string; mine: string; theirs: string }>(
          `select count(*)::text as total,
                  count(*) filter (where organization_id = $1 or organization_id is null)::text as mine,
                  count(*) filter (where organization_id = $2)::text as theirs
           from ${table}`,
          [a.orgId, b.orgId],
        ),
      );
      const row = visible.rows[0];
      expect(row?.theirs, `${table}: rows of B visible to A`).toBe('0');
      expect(row?.total, `${table}: total equals own rows (plus the global catalog)`).toBe(
        row?.mine,
      );
    }
  });

  it('A sees its seeded data in the main tables', async () => {
    for (const table of [
      'users',
      'groups',
      'roles',
      'accounts',
      'credentials',
      'credential_secrets',
      'shares',
      'sessions',
      'audit_events',
    ]) {
      const { rows } = await inOrg(app, a.orgId, () =>
        app.query<{ n: string }>(`select count(*)::text as n from ${table}`),
      );
      expect(Number(rows[0]?.n), table).toBeGreaterThan(0);
    }
  });

  it('A cannot read B rows by id', async () => {
    const { rowCount } = await inOrg(app, a.orgId, () =>
      app.query('select 1 from accounts where id = $1', [b.accountId]),
    );
    expect(rowCount).toBe(0);
    const orgs = await inOrg(app, a.orgId, () =>
      app.query<{ id: string }>('select id from organizations'),
    );
    expect(orgs.rows.map((r) => r.id)).toEqual([a.orgId]);
  });

  it('A cannot modify B rows', async () => {
    const updates: [string, string, string[]][] = [
      ['update users set display_name = $1 where id = $2', 'hijacked', [b.rootId]],
      ['update groups set description = $1 where id = $2', 'hijacked', [b.groupId]],
      ['update roles set permissions = $1::text[] where id = $2', '{org.settings}', [b.roleId]],
      ['update accounts set display_name = $1 where id = $2', 'hijacked', [b.accountId]],
      ['update credentials set label = $1 where id = $2', 'hijacked', [b.credentialId]],
      ['update shares set level = $1 where id = $2', 'MANAGE', [b.shareId]],
    ];
    for (const [sql, value, [id]] of updates) {
      const result = await inOrg(app, a.orgId, () => app.query(sql, [value, id]));
      expect(result.rowCount, sql).toBe(0);
    }
    const deletes = [
      'group_memberships',
      'user_roles',
      'sessions',
      'invitations',
      'outbox_events',
      'idempotency_keys',
    ];
    for (const table of deletes) {
      const result = await inOrg(app, a.orgId, () =>
        app.query(`delete from ${table} where organization_id = $1`, [b.orgId]),
      );
      expect(result.rowCount, table).toBe(0);
    }
    const intact = await admin.query<{ display_name: string }>(
      'select display_name from accounts where id = $1',
      [b.accountId],
    );
    expect(intact.rows[0]?.display_name).toBe('Brand MX');
  });

  it('A cannot insert rows for B, nor move its own rows to B', async () => {
    const insert = await sqlState(
      app,
      "insert into groups (organization_id, name, created_by) values ($1, 'smuggled', $2)",
      [b.orgId, b.rootId],
      a.orgId,
    );
    expect(insert).toBe('42501');
    const move = await sqlState(
      app,
      'update groups set organization_id = $1 where id = $2',
      [b.orgId, a.groupId],
      a.orgId,
    );
    expect(['42501', 'none']).toContain(move);
    const still = await admin.query<{ organization_id: string }>(
      'select organization_id from groups where id = $1',
      [a.groupId],
    );
    expect(still.rows[0]?.organization_id).toBe(a.orgId);
  });

  it('refuses cross-tenant references (composite foreign keys)', async () => {
    const state = await sqlState(
      app,
      "insert into credentials (organization_id, account_id, label, kind, created_by) values ($1, $2, 'x', 'password', $3)",
      [a.orgId, b.accountId, a.rootId],
      a.orgId,
    );
    expect(state).toBe('23503');
  });

  it('refuses shares whose grantee or resource does not exist in the organization', async () => {
    const foreignGrantee = await sqlState(
      app,
      "insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by) values ($1, 'account', $2, 'user', $3, 'USE', $4)",
      [a.orgId, a.accountId, b.operatorId, a.rootId],
      a.orgId,
    );
    expect(foreignGrantee).toBe('23503');
    const foreignResource = await sqlState(
      app,
      "insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by) values ($1, 'account', $2, 'user', $3, 'USE', $4)",
      [a.orgId, b.accountId, a.operatorId, a.rootId],
      a.orgId,
    );
    expect(foreignResource).toBe('23503');
  });

  it('refuses an account that points at another tenant platform', async () => {
    const state = await sqlState(
      app,
      "insert into accounts (organization_id, platform_id, display_name, created_by) values ($1, $2, 'x', $3)",
      [a.orgId, b.platformId, a.rootId],
      a.orgId,
    );
    expect(state).toBe('23503');
  });

  it('only lets the retention job delete superseded secret versions', async () => {
    const current = await inOrg(app, a.orgId, () =>
      app.query('delete from credential_secrets where is_current'),
    );
    expect(current.rowCount).toBe(0);
  });
});

describe('global platform catalog (organization_id null)', () => {
  it('is readable by every organization', async () => {
    const countFor = async (orgId: string): Promise<number> => {
      const { rows } = await inOrg(app, orgId, () =>
        app.query<{ n: string }>(
          'select count(*)::text as n from platforms where organization_id is null',
        ),
      );
      return Number(rows[0]?.n);
    };
    expect(await countFor(a.orgId)).toBeGreaterThanOrEqual(11);
    expect(await countFor(a.orgId)).toBe(await countFor(b.orgId));
  });

  it('cannot be modified, inserted into or deleted by iam_app', async () => {
    const update = await inOrg(app, a.orgId, () =>
      app.query("update platforms set name = 'pwned' where organization_id is null"),
    );
    expect(update.rowCount).toBe(0);
    const insert = await sqlState(
      app,
      "insert into platforms (organization_id, name, slug) values (null, 'Evil', 'evil')",
      [],
      a.orgId,
    );
    expect(insert).toBe('42501');
    const del = await sqlState(
      app,
      'delete from platforms where organization_id is null',
      [],
      a.orgId,
    );
    expect(del).toBe('42501');
    const takeover = await sqlState(
      app,
      'update platforms set organization_id = $1 where organization_id is null',
      [a.orgId],
      a.orgId,
    );
    expect(['42501', 'none']).toContain(takeover);
    const names = await admin.query(
      "select 1 from platforms where organization_id is null and name = 'pwned'",
    );
    expect(names.rowCount).toBe(0);
  });

  it('keeps organization-owned platforms private', async () => {
    const { rows } = await inOrg(app, b.orgId, () =>
      app.query('select 1 from platforms where id = $1', [a.platformId]),
    );
    expect(rows).toHaveLength(0);
  });
});
