import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

const NO_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const NO_FAILURE = 'none';
const UID_VALIDITY = 777;
const UID = 42;

let admin: Client;
let app: Client;
let worker: Client;
let a: Tenant;
let b: Tenant;
let sourceAId: string;
let sourceBId: string;

async function insertSource(tenant: Tenant, address: string, status = 'active'): Promise<string> {
  const { rows } = await inOrg(app, tenant.orgId, () =>
    app.query<{ id: string }>(
      `insert into mail_sources (organization_id, channel, address, display_name, created_by)
       values ($1, 'mail', $2, 'Buzón', $3) returning id`,
      [tenant.orgId, address, tenant.rootId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error('source was not created');
  if (status !== 'active') {
    await admin.query('update mail_sources set status = $2 where id = $1', [row.id, status]);
  }
  return row.id;
}

/** Inserta una petición con el rol de la API; devuelve el SQLSTATE o 'none'. */
async function insertRequest(
  tenant: Tenant,
  sourceId: string,
  receiptId: string,
  overrides: { uidValidity?: number; uid?: number } = {},
  client: Client = app,
): Promise<string> {
  return sqlState(
    client,
    `insert into mail_delete_requests
       (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, requested_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      tenant.orgId,
      sourceId,
      receiptId,
      overrides.uidValidity ?? UID_VALIDITY,
      overrides.uid ?? UID,
      tenant.rootId,
    ],
    tenant.orgId,
  );
}

const newReceiptId = async (): Promise<string> => {
  const { rows } = await admin.query<{ id: string }>('select uuid_generate_v7() as id');
  const row = rows[0];
  if (!row) throw new Error('no id');
  return row.id;
};

async function sourcesWithPendingDeletes(): Promise<string[]> {
  const { rows } = await worker.query<{ source_id: string }>(
    'select source_id from auth.list_sources_with_pending_mail_deletes()',
  );
  return rows.map((row) => row.source_id);
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
  worker = await connect(db.workerUrl);
  sourceAId = await insertSource(a, 'codes-a@inbound.example.test');
  sourceBId = await insertSource(b, 'codes-b@inbound.example.test');
});

afterAll(async () => {
  await admin.end();
  await app.end();
  await worker.end();
});

describe('mail_delete_requests: structure', () => {
  it('accepts a valid pending request and rejects an out-of-range or missing position', async () => {
    expect(await insertRequest(a, sourceAId, await newReceiptId())).toBe(NO_FAILURE);
    expect(await insertRequest(a, sourceAId, await newReceiptId(), { uid: 0 })).toBe(
      CHECK_VIOLATION,
    );
    expect(await insertRequest(a, sourceAId, await newReceiptId(), { uid: 4294967296 })).toBe(
      CHECK_VIOLATION,
    );
    expect(await insertRequest(a, sourceAId, await newReceiptId(), { uidValidity: -1 })).toBe(
      CHECK_VIOLATION,
    );
  });

  it('allows one pending request per receipt, and a new one after the first is closed', async () => {
    const receiptId = await newReceiptId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(UNIQUE_VIOLATION);
    await admin.query(
      "update mail_delete_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where receipt_id = $1",
      [receiptId],
    );
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
  });

  it('requires result and completion date together with a closed status', async () => {
    const receiptId = await newReceiptId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    expect(
      await sqlState(
        admin,
        "update mail_delete_requests set status = 'done' where receipt_id = $1",
        [receiptId],
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        admin,
        "update mail_delete_requests set result_code = 'DELETED' where receipt_id = $1",
        [receiptId],
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        admin,
        "update mail_delete_requests set status = 'done', result_code = 'deleted', completed_at = now() where receipt_id = $1",
        [receiptId],
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

// SENSIBLE (revisión humana): aislamiento por organización y mínimo privilegio del API y del worker.
describe('mail_delete_requests: isolation and privileges', () => {
  it('does not show one organization the requests of another, nor lets it write them', async () => {
    expect(await insertRequest(b, sourceBId, await newReceiptId())).toBe(NO_FAILURE);
    const { rows } = await inOrg(app, a.orgId, () =>
      app.query<{ source_id: string }>('select source_id from mail_delete_requests'),
    );
    expect(rows.map((row) => row.source_id)).not.toContain(sourceBId);
    const crossWrite = await sqlState(
      app,
      `insert into mail_delete_requests
         (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, requested_by)
       values ($1, $2, $3, 1, 1, $4)`,
      [b.orgId, sourceBId, await newReceiptId(), b.rootId],
      a.orgId,
    );
    expect(crossWrite).not.toBe(NO_FAILURE);
  });

  it('never lets the API update or delete a request: closing it belongs to the worker', async () => {
    const receiptId = await newReceiptId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    expect(
      await sqlState(
        app,
        "update mail_delete_requests set status = 'done', result_code = 'DELETED', completed_at = now() where receipt_id = $1",
        [receiptId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        app,
        'delete from mail_delete_requests where receipt_id = $1',
        [receiptId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
  });

  it('lets the worker read what it needs but not who asked, and never insert or delete', async () => {
    const receiptId = await newReceiptId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    const { rows } = await inOrg(worker, a.orgId, () =>
      worker.query(
        'select id, source_id, mailbox_uid_validity, mailbox_uid, status from mail_delete_requests where source_id = $1 and status = $2',
        [sourceAId, 'pending'],
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // `receipt_id` y `requested_by` no están entre las columnas que el worker puede leer.
    expect(
      await sqlState(worker, 'select requested_by from mail_delete_requests', [], a.orgId),
    ).toBe(NO_PRIVILEGE);
    expect(await insertRequest(a, sourceAId, await newReceiptId(), {}, worker)).toBe(NO_PRIVILEGE);
    expect(await sqlState(worker, 'delete from mail_delete_requests', [], a.orgId)).toBe(
      NO_PRIVILEGE,
    );
  });

  it('lets the worker close a request but not change its target or position', async () => {
    const receiptId = await newReceiptId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    const { rows } = await admin.query<{ id: string }>(
      'select id from mail_delete_requests where receipt_id = $1',
      [receiptId],
    );
    const requestId = rows[0]?.id;
    expect(requestId).toBeDefined();
    expect(
      await sqlState(
        worker,
        'update mail_delete_requests set mailbox_uid = 1 where id = $1',
        [requestId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        worker,
        'update mail_delete_requests set source_id = $2 where id = $1',
        [requestId, sourceBId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        worker,
        "update mail_delete_requests set status = 'done', result_code = 'DELETED', completed_at = now() where id = $1",
        [requestId],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
  });

  it('does not let the worker close a request of another organization', async () => {
    const receiptId = await newReceiptId();
    expect(await insertRequest(b, sourceBId, receiptId)).toBe(NO_FAILURE);
    await inOrg(worker, a.orgId, () =>
      worker.query(
        "update mail_delete_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where status = 'pending'",
      ),
    );
    const { rows } = await admin.query<{ status: string }>(
      'select status from mail_delete_requests where receipt_id = $1',
      [receiptId],
    );
    expect(rows[0]?.status).toBe('pending');
  });
});

// SENSIBLE (revisión humana): función que enumera entre organizaciones para un rol que no es la API.
describe('auth.list_sources_with_pending_mail_deletes', () => {
  it('is executable by the worker only and returns exactly organization and source', async () => {
    const { fields } = await worker.query(
      'select * from auth.list_sources_with_pending_mail_deletes()',
    );
    expect(fields.map((field) => field.name)).toEqual(['organization_id', 'source_id']);
    expect(await sqlState(app, 'select * from auth.list_sources_with_pending_mail_deletes()')).toBe(
      NO_PRIVILEGE,
    );
  });

  it('lists active sources with a pending request across organizations, once each', async () => {
    await admin.query(
      "update mail_delete_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where status = 'pending'",
    );
    expect(await sourcesWithPendingDeletes()).toEqual([]);
    expect(await insertRequest(a, sourceAId, await newReceiptId())).toBe(NO_FAILURE);
    expect(await insertRequest(a, sourceAId, await newReceiptId())).toBe(NO_FAILURE);
    expect(await insertRequest(b, sourceBId, await newReceiptId())).toBe(NO_FAILURE);
    const ids = await sourcesWithPendingDeletes();
    expect([...ids].sort()).toEqual([sourceAId, sourceBId].sort());
  });

  it('skips closed requests and sources that are no longer active', async () => {
    await admin.query(
      "update mail_delete_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where status = 'pending'",
    );
    const suspendedId = await insertSource(a, 'suspended@inbound.example.test');
    expect(await insertRequest(a, suspendedId, await newReceiptId())).toBe(NO_FAILURE);
    expect(await sourcesWithPendingDeletes()).toContain(suspendedId);
    await admin.query("update mail_sources set status = 'suspended' where id = $1", [suspendedId]);
    expect(await sourcesWithPendingDeletes()).not.toContain(suspendedId);
  });
});

describe('auth.list_sources_with_stale_mail_deletes (0039)', () => {
  const HOURS_AGO_30 = "now() - interval '30 hours'";

  async function staleSources(cutoffSql: string): Promise<string[]> {
    const { rows } = await worker.query<{ source_id: string }>(
      `select source_id from auth.list_sources_with_stale_mail_deletes(${cutoffSql})`,
    );
    return rows.map((row) => row.source_id);
  }

  it('is executable by the worker only and returns exactly organization and source', async () => {
    const { fields } = await worker.query(
      "select * from auth.list_sources_with_stale_mail_deletes(now() - interval '24 hours')",
    );
    expect(fields.map((field) => field.name)).toEqual(['organization_id', 'source_id']);
    expect(
      await sqlState(
        app,
        "select * from auth.list_sources_with_stale_mail_deletes(now() - interval '24 hours')",
      ),
    ).toBe(NO_PRIVILEGE);
  });

  it('lists a source with an old pending request even when the source is suspended', async () => {
    await admin.query(
      "update mail_delete_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where status = 'pending'",
    );
    const suspendedId = await insertSource(a, 'stale-suspended@inbound.example.test');
    const receiptId = await newReceiptId();
    expect(await insertRequest(a, suspendedId, receiptId)).toBe(NO_FAILURE);
    await admin.query('update mail_sources set status = $2 where id = $1', [
      suspendedId,
      'suspended',
    ]);
    await admin.query(
      `update mail_delete_requests set requested_at = ${HOURS_AGO_30} where receipt_id = $1`,
      [receiptId],
    );

    expect(await staleSources("now() - interval '24 hours'")).toContain(suspendedId);
    expect(await sourcesWithPendingDeletes()).not.toContain(suspendedId);
  });

  it('does not list a recent request, nor one already closed', async () => {
    await admin.query(
      "update mail_delete_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where status = 'pending'",
    );
    expect(await insertRequest(a, sourceAId, await newReceiptId())).toBe(NO_FAILURE);
    expect(await staleSources("now() - interval '24 hours'")).toEqual([]);
  });

  it('lets the worker read requested_at and close an old request as EXPIRED, but not a recent one by age', async () => {
    await admin.query(
      "update mail_delete_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where status = 'pending'",
    );
    const oldReceipt = await newReceiptId();
    const recentReceipt = await newReceiptId();
    expect(await insertRequest(a, sourceAId, oldReceipt)).toBe(NO_FAILURE);
    expect(await insertRequest(a, sourceAId, recentReceipt)).toBe(NO_FAILURE);
    await admin.query(
      `update mail_delete_requests set requested_at = ${HOURS_AGO_30} where receipt_id = $1`,
      [oldReceipt],
    );

    const { rowCount } = await inOrg(worker, a.orgId, () =>
      worker.query(
        `update mail_delete_requests
            set status = 'failed', result_code = 'EXPIRED', completed_at = now()
          where organization_id = $1 and source_id = $2 and status = 'pending'
            and requested_at < now() - interval '24 hours'`,
        [a.orgId, sourceAId],
      ),
    );

    expect(rowCount).toBe(1);
    const { rows } = await admin.query<{ receipt_id: string; status: string }>(
      'select receipt_id, status from mail_delete_requests where receipt_id = any($1)',
      [[oldReceipt, recentReceipt]],
    );
    const statusByReceipt = Object.fromEntries(rows.map((row) => [row.receipt_id, row.status]));
    expect(statusByReceipt).toEqual({ [oldReceipt]: 'failed', [recentReceipt]: 'pending' });
  });
});
