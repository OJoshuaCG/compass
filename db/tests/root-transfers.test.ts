import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

// SENSIBLE (revisión humana): pruebas de la migración 0035, transferencias de la Raíz. Una sola abierta por
// organización, fechas coherentes con el estado, sin borrado y con aislamiento por organización.

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

const INSERT_PENDING = `insert into root_transfers (organization_id, from_user_id, to_user_id, requested_at, expires_at)
  values ($1, $2, $3, now(), now() + interval '7 days')`;

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

describe('root_transfers allows one open transfer per organization', () => {
  it('rejects a second open transfer but accepts one once the first is closed', async () => {
    await inOrg(app, a.orgId, () => app.query(INSERT_PENDING, [a.orgId, a.rootId, a.adminId]));
    expect(await sqlState(app, INSERT_PENDING, [a.orgId, a.rootId, a.adminId], a.orgId)).toBe(
      UNIQUE_VIOLATION,
    );

    await inOrg(app, a.orgId, () =>
      app.query(
        `update root_transfers set status = 'cancelled', closed_at = now(), cancel_reason = 'manual'
          where organization_id = $1`,
        [a.orgId],
      ),
    );
    await inOrg(app, a.orgId, () => app.query(INSERT_PENDING, [a.orgId, a.rootId, a.adminId]));
  });
});

describe('root_transfers keeps its dates consistent with its status', () => {
  it('rejects a transfer to the same person', async () => {
    expect(await sqlState(app, INSERT_PENDING, [b.orgId, b.rootId, b.rootId], b.orgId)).toBe(
      CHECK_VIOLATION,
    );
  });

  it('rejects a waiting transfer without acceptance dates', async () => {
    const state = await sqlState(
      app,
      `insert into root_transfers (organization_id, from_user_id, to_user_id, status, requested_at, expires_at)
       values ($1, $2, $3, 'waiting', now(), now() + interval '7 days')`,
      [b.orgId, b.rootId, b.adminId],
      b.orgId,
    );
    expect(state).toBe(CHECK_VIOLATION);
  });

  it('rejects a cancelled transfer without a reason or an open one with a closing date', async () => {
    const withoutReason = await sqlState(
      app,
      `insert into root_transfers (organization_id, from_user_id, to_user_id, status, requested_at, expires_at, closed_at)
       values ($1, $2, $3, 'cancelled', now(), now() + interval '7 days', now())`,
      [b.orgId, b.rootId, b.adminId],
      b.orgId,
    );
    expect(withoutReason).toBe(CHECK_VIOLATION);

    const openButClosed = await sqlState(
      app,
      `insert into root_transfers (organization_id, from_user_id, to_user_id, requested_at, expires_at, closed_at)
       values ($1, $2, $3, now(), now() + interval '7 days', now())`,
      [b.orgId, b.rootId, b.adminId],
      b.orgId,
    );
    expect(openButClosed).toBe(CHECK_VIOLATION);
  });
});

describe('root_transfers privileges', () => {
  it('grants iam_app no DELETE and no UPDATE on the people or the organization', async () => {
    const privileges = await admin.query<Record<string, boolean>>(
      `select has_table_privilege('iam_app', 'root_transfers', 'DELETE') as del,
              has_table_privilege('iam_app', 'root_transfers', 'TRUNCATE') as trunc,
              has_column_privilege('iam_app', 'root_transfers', 'organization_id', 'UPDATE') as "updOrg",
              has_column_privilege('iam_app', 'root_transfers', 'to_user_id', 'UPDATE') as "updTo",
              has_column_privilege('iam_app', 'root_transfers', 'from_user_id', 'UPDATE') as "updFrom"`,
    );
    expect(privileges.rows[0]).toEqual({
      del: false,
      trunc: false,
      updOrg: false,
      updTo: false,
      updFrom: false,
    });
    expect(await sqlState(app, 'delete from root_transfers', [], a.orgId)).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe('root_transfers isolation', () => {
  it('shows each organization only its own transfers', async () => {
    await inOrg(app, b.orgId, () => app.query(INSERT_PENDING, [b.orgId, b.rootId, b.adminId]));
    const { rows } = await inOrg(app, b.orgId, () =>
      app.query<{ organization_id: string }>('select organization_id from root_transfers'),
    );
    expect(rows).toEqual([{ organization_id: b.orgId }]);
  });

  it('rejects a transfer written for another organization', async () => {
    expect(await sqlState(app, INSERT_PENDING, [a.orgId, a.rootId, a.adminId], b.orgId)).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });
});
