import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

let adminUrl = '';
let appUrl = '';
let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

async function auditRows(
  orgId: string,
): Promise<{ seq: string; prev_hash: Buffer; hash: Buffer }[]> {
  const { rows } = await inOrg(app, orgId, () =>
    app.query<{ seq: string; prev_hash: Buffer; hash: Buffer }>(
      'select e.seq::text as seq, e.prev_hash, e.hash from audit_events e order by e.seq',
    ),
  );
  return rows;
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  adminUrl = db.adminUrl;
  appUrl = db.appUrl;
  a = await seedTenant(appUrl, adminUrl, 'a');
  b = await seedTenant(appUrl, adminUrl, 'b');
  admin = await connect(adminUrl);
  app = await connect(appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('audit_events is append-only', () => {
  it('denies UPDATE, DELETE and TRUNCATE to iam_app', async () => {
    expect(await sqlState(app, "update audit_events set action = 'x'", [], a.orgId)).toBe('42501');
    expect(await sqlState(app, 'delete from audit_events', [], a.orgId)).toBe('42501');
    expect(await sqlState(app, 'truncate audit_events')).toBe('42501');
    const priv = await admin.query<{ upd: boolean; del: boolean; ins: boolean; sel: boolean }>(
      `select has_table_privilege('iam_app', 'audit_events', 'UPDATE') as upd,
              has_table_privilege('iam_app', 'audit_events', 'DELETE') as del,
              has_table_privilege('iam_app', 'audit_events', 'INSERT') as ins,
              has_table_privilege('iam_app', 'audit_events', 'SELECT') as sel`,
    );
    expect(priv.rows[0]).toEqual({ upd: false, del: false, ins: true, sel: true });
  });

  it('is also immutable for roles that hold the privilege (superuser) through triggers', async () => {
    await expect(admin.query("update audit_events set action = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(admin.query('delete from audit_events')).rejects.toThrow(/append-only/);
    await expect(admin.query('truncate audit_events')).rejects.toThrow(/append-only/);
  });

  it('has no UPDATE or DELETE policy and the owner gave up those rights', async () => {
    const { rows } = await admin.query<{ cmd: string }>(
      "select cmd from pg_policies where tablename = 'audit_events' order by cmd",
    );
    expect(rows.map((r) => r.cmd)).toEqual(['INSERT', 'SELECT']);
    const owner = await admin.query<{ upd: boolean; del: boolean }>(
      "select has_table_privilege('iam_migrator', 'audit_events', 'UPDATE') as upd, has_table_privilege('iam_migrator', 'audit_events', 'DELETE') as del",
    );
    expect(owner.rows[0]).toEqual({ upd: false, del: false });
  });
});

describe('hash chain per organization', () => {
  it('assigns seq, prev_hash and hash itself, ignoring client-supplied values', async () => {
    await inOrg(app, a.orgId, () =>
      app.query(
        "insert into audit_events (organization_id, actor_id, action, outcome, seq, prev_hash, hash) values ($1, $2, 'user.invited', 'success', 999, '\\xdead', '\\xbeef')",
        [a.orgId, a.rootId],
      ),
    );
    const rows = await auditRows(a.orgId);
    expect(rows.map((r) => r.seq)).toEqual(['1', '2']);
    expect(rows[0]?.prev_hash.equals(Buffer.alloc(32))).toBe(true);
    expect(rows[1]?.prev_hash.equals(rows[0]?.hash ?? Buffer.alloc(0))).toBe(true);
    expect(rows[1]?.hash).toHaveLength(32);
  });

  it('keeps an independent chain per organization', async () => {
    const rows = await auditRows(b.orgId);
    expect(rows.map((r) => r.seq)).toEqual(['1']);
    expect(rows[0]?.prev_hash.equals(Buffer.alloc(32))).toBe(true);
  });

  it('refuses events for another organization', async () => {
    const state = await sqlState(
      app,
      "insert into audit_events (organization_id, action, outcome) values ($1, 'x', 'success')",
      [b.orgId],
      a.orgId,
    );
    expect(state).toBe('42501');
  });

  it('does not fork under concurrent writers (advisory lock)', async () => {
    const clients = await Promise.all(Array.from({ length: 8 }, () => connect(appUrl)));
    try {
      await Promise.all(
        clients.flatMap((c, i) =>
          [0, 1, 2].map(async (j) => {
            // Each writer uses its own transaction, as concurrent requests would.
            if (j > 0) return; // one in-flight transaction per connection
            await inOrg(c, a.orgId, () =>
              c.query(
                "insert into audit_events (organization_id, actor_id, action, outcome, metadata) values ($1, $2, 'credential.revealed', 'success', $3)",
                [a.orgId, a.rootId, JSON.stringify({ n: i })],
              ),
            );
          }),
        ),
      );
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
    const rows = await auditRows(a.orgId);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    rows.slice(1).forEach((row, i) => {
      expect(row.prev_hash.equals(rows[i]?.hash ?? Buffer.alloc(0))).toBe(true);
    });
    const verdict = await inOrg(app, a.orgId, () =>
      app.query<{ broken: string | null }>('select audit_verify_chain()::text as broken'),
    );
    expect(verdict.rows[0]?.broken).toBeNull();
  });

  it('detects tampering with an event (verification returns the first broken seq)', async () => {
    const owner = await connect(adminUrl);
    try {
      await owner.query('alter table audit_events disable trigger audit_events_no_update_delete');
      await owner.query(
        'update audit_events set metadata = \'{"forged":true}\' where organization_id = $1 and seq = 3',
        [a.orgId],
      );
      await owner.query('alter table audit_events enable trigger audit_events_no_update_delete');
    } finally {
      await owner.end();
    }
    const verdict = await inOrg(app, a.orgId, () =>
      app.query<{ broken: string | null }>('select audit_verify_chain()::text as broken'),
    );
    expect(verdict.rows[0]?.broken).toBe('3');
    const other = await inOrg(app, b.orgId, () =>
      app.query<{ broken: string | null }>('select audit_verify_chain()::text as broken'),
    );
    expect(other.rows[0]?.broken).toBeNull();
  });

  it('verification sees nothing without an organization context', async () => {
    const { rows } = await app.query<{ broken: string | null }>(
      'select audit_verify_chain()::text as broken',
    );
    expect(rows[0]?.broken).toBeNull();
  });
});
