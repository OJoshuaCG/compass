import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import {
  connect,
  createMigratedDatabase,
  createOrganization,
  inOrg,
  seedTenant,
  sqlState,
} from './helpers.js';
import type { Tenant } from './helpers.js';

let app: Client;
let admin: Client;
let appUrl = '';
let adminUrl = '';
let a: Tenant;

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  appUrl = db.appUrl;
  adminUrl = db.adminUrl;
  a = await seedTenant(appUrl, adminUrl, 'a');
  admin = await connect(adminUrl);
  app = await connect(appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

const newUser =
  "insert into users (organization_id, email, display_name, rank, status, managed_by) values ($1, $2, 'U', $3, $4, $5)";

describe('user hierarchy constraints', () => {
  it('allows only one active Root per organization', async () => {
    const second = await sqlState(
      app,
      newUser,
      [a.orgId, 'second-root@example.test', 0, 'active', null],
      a.orgId,
    );
    expect(second).toBe('23505');
    const suspended = await sqlState(
      app,
      newUser,
      [a.orgId, 'third-root@example.test', 0, 'suspended', null],
      a.orgId,
    );
    expect(suspended).toBe('23505');
  });

  it('allows a new Root once the previous one is deactivated, and one Root in another organization', async () => {
    const orgId = await createOrganization(adminUrl, 'org-root-swap');
    const app2 = await connect(appUrl);
    try {
      await inOrg(app2, orgId, async () => {
        await app2.query(newUser, [orgId, 'old-root@example.test', 0, 'active', null]);
        await app2.query(
          "update users set status = 'deactivated' where email = 'old-root@example.test'",
        );
        await app2.query(newUser, [orgId, 'new-root@example.test', 0, 'active', null]);
      });
      const { rows } = await admin.query<{ n: string }>(
        "select count(*)::text as n from users where organization_id = $1 and rank = 0 and status <> 'deactivated'",
        [orgId],
      );
      expect(rows[0]?.n).toBe('1');
    } finally {
      await app2.end();
    }
  });

  it('rejects ranks outside 0..3', async () => {
    expect(
      await sqlState(app, newUser, [a.orgId, 'r4@example.test', 4, 'active', a.rootId], a.orgId),
    ).toBe('23514');
    expect(
      await sqlState(app, newUser, [a.orgId, 'rneg@example.test', -1, 'active', a.rootId], a.orgId),
    ).toBe('23514');
    for (const rank of [1, 2, 3]) {
      expect(
        await sqlState(
          app,
          newUser,
          [a.orgId, `ok${String(rank)}@example.test`, rank, 'active', a.rootId],
          a.orgId,
        ),
      ).toBe('none');
    }
  });

  it('rejects invitations for rank 0 or 4, unknown statuses and a non-Root without responsible', async () => {
    const invite =
      'insert into invitations (organization_id, email, rank, invited_by, managed_by, token_hash, expires_at) values ($1, $2, $3, $4, $4, $5, now())';
    expect(
      await sqlState(
        app,
        invite,
        [a.orgId, 'i0@example.test', 0, a.rootId, Buffer.alloc(32, 1)],
        a.orgId,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        app,
        invite,
        [a.orgId, 'i4@example.test', 4, a.rootId, Buffer.alloc(32, 2)],
        a.orgId,
      ),
    ).toBe('23514');
    expect(
      await sqlState(app, newUser, [a.orgId, 'bad@example.test', 2, 'zombie', a.rootId], a.orgId),
    ).toBe('23514');
    expect(
      await sqlState(app, newUser, [a.orgId, 'orphan@example.test', 2, 'active', null], a.orgId),
    ).toBe('23514');
    expect(
      await sqlState(
        app,
        newUser,
        [a.orgId, 'rootmanaged@example.test', 0, 'deactivated', a.rootId],
        a.orgId,
      ),
    ).toBe('23514');
  });

  it('keeps login emails globally unique, lowercase and pending invitations unique per email', async () => {
    const other = await createOrganization(adminUrl, 'org-dupe');
    const clash = await sqlState(app, newUser, [other, a.rootEmail, 0, 'active', null], other);
    expect(clash).toBe('23505');
    expect(
      await sqlState(
        app,
        newUser,
        [a.orgId, 'MixedCase@example.test', 2, 'active', a.rootId],
        a.orgId,
      ),
    ).toBe('23514');
    const dupInvite = await sqlState(
      app,
      "insert into invitations (organization_id, email, rank, invited_by, managed_by, token_hash, expires_at) values ($1, 'a-invitee@example.test', 2, $2, $2, $3, now())",
      [a.orgId, a.rootId, Buffer.alloc(32, 9)],
      a.orgId,
    );
    expect(dupInvite).toBe('23505');
  });

  it('forbids self-management and cross-organization managers', async () => {
    expect(
      await sqlState(
        app,
        'update users set managed_by = id where id = $1',
        [a.operatorId],
        a.orgId,
      ),
    ).toBe('23514');
    const other = await createOrganization(adminUrl, 'org-manager');
    expect(
      await sqlState(app, newUser, [other, 'x-manager@example.test', 2, 'active', a.rootId], other),
    ).toBe('23503');
  });
});

describe('shares and effective_access', () => {
  it('rejects levels outside USE/VIEW/EDIT/MANAGE and duplicate live shares', async () => {
    const share =
      "insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by) values ($1, 'account', $2, 'user', $3, $4, $5)";
    expect(
      await sqlState(app, share, [a.orgId, a.accountId, a.adminId, 'OWNER', a.rootId], a.orgId),
    ).toBe('23514');
    expect(
      await sqlState(app, share, [a.orgId, a.accountId, a.operatorId, 'USE', a.rootId], a.orgId),
    ).toBe('23505');
  });

  it('combines direct and group grants by maximum level and ignores expired and revoked ones', async () => {
    const { rows } = await inOrg(app, a.orgId, async () => {
      // operator: direct VIEW (seed). Group "Social" (operator is a member) grants EDIT.
      await app.query(
        "insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by) values ($1, 'account', $2, 'group', $3, 'EDIT', $4)",
        [a.orgId, a.accountId, a.groupId, a.rootId],
      );
      // admin: expired direct MANAGE and revoked direct MANAGE are both ignored.
      await app.query(
        "insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by, expires_at) values ($1, 'account', $2, 'user', $3, 'MANAGE', $4, now() - interval '1 minute')",
        [a.orgId, a.accountId, a.adminId, a.rootId],
      );
      const { rows: expired } = await app.query<{ n: string }>(
        'select count(*)::text as n from effective_access where user_id = $1',
        [a.adminId],
      );
      expect(expired[0]?.n).toBe('0');
      return app.query<{ user_id: string; level: string; sources: string[] }>(
        'select user_id, level, sources from effective_access order by user_id',
      );
    });
    expect(rows).toEqual([{ user_id: a.operatorId, level: 'EDIT', sources: ['direct', 'group'] }]);
  });

  it('is scoped by RLS (security_invoker)', async () => {
    const { rows } = await app.query('select * from effective_access');
    expect(rows).toHaveLength(0);
  });
});

describe('identifiers and secrets', () => {
  it('generates UUIDv7 (version 7, RFC variant, time-ordered)', async () => {
    const { rows } = await admin.query<{ ids: string[]; now_ms: string }>(
      'select array(select uuid_generate_v7() from generate_series(1, 50)) as ids, (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now_ms',
    );
    const ids = rows[0]?.ids ?? [];
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    const ts = parseInt(ids[0]?.replace('-', '').slice(0, 12) ?? '0', 16);
    expect(Math.abs(Number(rows[0]?.now_ms) - ts)).toBeLessThan(10_000);
    expect(new Set(ids).size).toBe(50);
  });

  it('keeps exactly one current version per secret field and a 12-byte nonce', async () => {
    const dup = await sqlState(
      app,
      "insert into credential_secrets (organization_id, credential_id, field, version, ciphertext, nonce, dek_version, created_by) values ($1, $2, 'password', 2, '\\x00112233445566778899aabbccddeeff00', '\\x000000000000000000000000', 1, $3)",
      [a.orgId, a.credentialId, a.rootId],
      a.orgId,
    );
    expect(dup).toBe('23505');
    const badNonce = await sqlState(
      app,
      "insert into credential_secrets (organization_id, credential_id, field, version, ciphertext, nonce, dek_version, is_current, created_by) values ($1, $2, 'username', 1, '\\x00112233445566778899aabbccddeeff00', '\\x0000', 1, false, $3)",
      [a.orgId, a.credentialId, a.rootId],
      a.orgId,
    );
    expect(badNonce).toBe('23514');
    const badField = await sqlState(
      app,
      "insert into credential_secrets (organization_id, credential_id, field, version, ciphertext, nonce, dek_version, is_current, created_by) values ($1, $2, 'pin', 1, '\\x00112233445566778899aabbccddeeff00', '\\x000000000000000000000000', 1, false, $3)",
      [a.orgId, a.credentialId, a.rootId],
      a.orgId,
    );
    expect(badField).toBe('23514');
  });

  it('does not let iam_app rewrite stored ciphertext or key material', async () => {
    expect(
      await sqlState(app, "update credential_secrets set ciphertext = '\\x00'", [], a.orgId),
    ).toBe('42501');
    expect(await sqlState(app, "update data_keys set wrapped_dek = '\\x00'", [], a.orgId)).toBe(
      '42501',
    );
  });
});
