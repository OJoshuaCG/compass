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
const FIFTEEN_MINUTES_SQL = "now() + interval '15 minutes'";

let admin: Client;
let app: Client;
let worker: Client;
let a: Tenant;
let b: Tenant;
let sourceAId: string;
let sourceBId: string;

async function insertSource(tenant: Tenant, address: string): Promise<string> {
  const { rows } = await inOrg(app, tenant.orgId, () =>
    app.query<{ id: string }>(
      `insert into mail_sources (organization_id, channel, address, display_name, created_by)
       values ($1, 'mail', $2, 'Buzón', $3) returning id`,
      [tenant.orgId, address, tenant.rootId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error('source was not created');
  return row.id;
}

const newId = async (): Promise<string> => {
  const { rows } = await admin.query<{ id: string }>('select uuid_generate_v7() as id');
  const row = rows[0];
  if (!row) throw new Error('no id');
  return row.id;
};

/** Inserta una petición con el rol de la API; devuelve el SQLSTATE o 'none'. */
async function insertRequest(
  tenant: Tenant,
  sourceId: string,
  receiptId: string,
  kind: 'subject' | 'body' = 'subject',
  client: Client = app,
): Promise<string> {
  return sqlState(
    client,
    `insert into mail_preview_requests
       (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, kind, requested_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, ${FIFTEEN_MINUTES_SQL})`,
    [tenant.orgId, sourceId, receiptId, UID_VALIDITY, UID, kind, tenant.rootId],
    tenant.orgId,
  );
}

async function requestIdOf(receiptId: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'select id from mail_preview_requests where receipt_id = $1 order by requested_at desc limit 1',
    [receiptId],
  );
  const row = rows[0];
  if (!row) throw new Error('request not found');
  return row.id;
}

async function currentDataKeyVersion(tenant: Tenant): Promise<number> {
  const { rows } = await admin.query<{ version: number }>(
    'select max(version) as version from data_keys where organization_id = $1',
    [tenant.orgId],
  );
  const version = rows[0]?.version;
  if (version === undefined || version === null) throw new Error('no data key for the tenant');
  return Number(version);
}

/** Cierra la petición como lista, con contenido ficticio; lo hace el rol administrador (fixture). */
async function makeReady(tenant: Tenant, requestId: string): Promise<void> {
  const version = await currentDataKeyVersion(tenant);
  await admin.query(
    `update mail_preview_requests
        set status = 'ready', result_code = 'READY', completed_at = now(),
            ciphertext = decode(repeat('ab', 32), 'hex'), nonce = decode(repeat('cd', 12), 'hex'),
            dek_version = $2
      where id = $1`,
    [requestId, version],
  );
}

async function sourcesWithPendingPreviews(): Promise<string[]> {
  const { rows } = await worker.query<{ source_id: string }>(
    'select source_id from auth.list_sources_with_pending_mail_previews(now())',
  );
  return rows.map((row) => row.source_id);
}

async function sourcesWithExpiredPreviews(): Promise<string[]> {
  const { rows } = await worker.query<{ source_id: string }>(
    'select source_id from auth.list_sources_with_expired_mail_previews(now())',
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

describe('mail_preview_requests: structure', () => {
  it('accepts subject and body requests and rejects an unknown kind', async () => {
    const receiptId = await newId();
    expect(await insertRequest(a, sourceAId, receiptId, 'subject')).toBe(NO_FAILURE);
    expect(await insertRequest(a, sourceAId, receiptId, 'body')).toBe(NO_FAILURE);
    expect(
      await sqlState(
        app,
        `insert into mail_preview_requests
           (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, kind, requested_by, expires_at)
         values ($1, $2, $3, 1, 1, 'headers', $4, ${FIFTEEN_MINUTES_SQL})`,
        [a.orgId, sourceAId, await newId(), a.rootId],
        a.orgId,
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('allows one live request per receipt and kind, and a new one after a failure', async () => {
    const receiptId = await newId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(UNIQUE_VIOLATION);
    await admin.query(
      "update mail_preview_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where receipt_id = $1",
      [receiptId],
    );
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
  });

  it('keeps content and state consistent: ready needs ciphertext, pending and failed carry none', async () => {
    const receiptId = await newId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    const requestId = await requestIdOf(receiptId);
    expect(
      await sqlState(
        admin,
        "update mail_preview_requests set status = 'ready', result_code = 'READY', completed_at = now() where id = $1",
        [requestId],
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        admin,
        "update mail_preview_requests set ciphertext = decode(repeat('ab', 32), 'hex') where id = $1",
        [requestId],
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        admin,
        `update mail_preview_requests
            set status = 'failed', result_code = 'NOT_FOUND', completed_at = now(),
                ciphertext = decode(repeat('ab', 32), 'hex'), nonce = decode(repeat('cd', 12), 'hex'), dek_version = 1
          where id = $1`,
        [requestId],
      ),
    ).toBe(CHECK_VIOLATION);
    await makeReady(a, requestId);
  });
});

// SENSIBLE (revisión humana): aislamiento por organización y mínimo privilegio del API y del worker sobre
// contenido de correo cifrado.
describe('mail_preview_requests: isolation and privileges', () => {
  it('does not show one organization the requests of another, nor lets it write them', async () => {
    expect(await insertRequest(b, sourceBId, await newId())).toBe(NO_FAILURE);
    const { rows } = await inOrg(app, a.orgId, () =>
      app.query<{ source_id: string }>('select source_id from mail_preview_requests'),
    );
    expect(rows.map((row) => row.source_id)).not.toContain(sourceBId);
    const crossWrite = await sqlState(
      app,
      `insert into mail_preview_requests
         (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, kind, requested_by, expires_at)
       values ($1, $2, $3, 1, 1, 'subject', $4, ${FIFTEEN_MINUTES_SQL})`,
      [b.orgId, sourceBId, await newId(), b.rootId],
      a.orgId,
    );
    expect(crossWrite).not.toBe(NO_FAILURE);
  });

  it('lets the API delete a row on delivery but never update it', async () => {
    const receiptId = await newId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    expect(
      await sqlState(
        app,
        "update mail_preview_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where receipt_id = $1",
        [receiptId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        app,
        'delete from mail_preview_requests where receipt_id = $1',
        [receiptId],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
  });

  it('does not let the API delete a row of another organization', async () => {
    const receiptId = await newId();
    expect(await insertRequest(b, sourceBId, receiptId)).toBe(NO_FAILURE);
    await inOrg(app, a.orgId, () => app.query('delete from mail_preview_requests'));
    const { rows } = await admin.query('select 1 from mail_preview_requests where receipt_id = $1', [
      receiptId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('lets the worker read what it needs, never who asked nor the ciphertext, and never insert', async () => {
    const receiptId = await newId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    const { rows } = await inOrg(worker, a.orgId, () =>
      worker.query(
        'select id, source_id, mailbox_uid_validity, mailbox_uid, kind, status, expires_at from mail_preview_requests where source_id = $1',
        [sourceAId],
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const hidden of ['requested_by', 'receipt_id', 'ciphertext', 'nonce']) {
      expect(
        await sqlState(worker, `select ${hidden} from mail_preview_requests`, [], a.orgId),
      ).toBe(NO_PRIVILEGE);
    }
    expect(await insertRequest(a, sourceAId, await newId(), 'subject', worker)).toBe(NO_PRIVILEGE);
  });

  it('lets the worker leave encrypted content but not change the target or the position', async () => {
    const receiptId = await newId();
    expect(await insertRequest(a, sourceAId, receiptId)).toBe(NO_FAILURE);
    const requestId = await requestIdOf(receiptId);
    const version = await currentDataKeyVersion(a);
    for (const forbidden of ['mailbox_uid = 1', `source_id = '${sourceBId}'`, "kind = 'body'"]) {
      expect(
        await sqlState(
          worker,
          `update mail_preview_requests set ${forbidden} where id = $1`,
          [requestId],
          a.orgId,
        ),
      ).toBe(NO_PRIVILEGE);
    }
    expect(
      await sqlState(
        worker,
        `update mail_preview_requests
            set status = 'ready', result_code = 'READY', completed_at = now(),
                ciphertext = decode(repeat('ab', 32), 'hex'), nonce = decode(repeat('cd', 12), 'hex'),
                dek_version = $2, expires_at = ${FIFTEEN_MINUTES_SQL}
          where id = $1`,
        [requestId, version],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
  });

  it('does not let the worker touch or purge rows of another organization', async () => {
    const receiptId = await newId();
    expect(await insertRequest(b, sourceBId, receiptId)).toBe(NO_FAILURE);
    await inOrg(worker, a.orgId, () => worker.query('delete from mail_preview_requests'));
    await inOrg(worker, a.orgId, () =>
      worker.query(
        "update mail_preview_requests set status = 'failed', result_code = 'NOT_FOUND', completed_at = now() where status = 'pending'",
      ),
    );
    const { rows } = await admin.query<{ status: string }>(
      'select status from mail_preview_requests where receipt_id = $1',
      [receiptId],
    );
    expect(rows[0]?.status).toBe('pending');
  });
});

// SENSIBLE (revisión humana): funciones que enumeran entre organizaciones para un rol que no es la API.
describe('auth.list_sources_with_*_mail_previews', () => {
  it('are executable by the worker only and return exactly organization and source', async () => {
    for (const fn of ['pending', 'expired']) {
      const call = `select * from auth.list_sources_with_${fn}_mail_previews(now())`;
      const { fields } = await worker.query(call);
      expect(fields.map((field) => field.name)).toEqual(['organization_id', 'source_id']);
      expect(await sqlState(app, call)).toBe(NO_PRIVILEGE);
    }
  });

  it('lists active sources with a live pending request, once each, and skips expired ones', async () => {
    await admin.query('delete from mail_preview_requests');
    expect(await sourcesWithPendingPreviews()).toEqual([]);
    expect(await insertRequest(a, sourceAId, await newId())).toBe(NO_FAILURE);
    expect(await insertRequest(a, sourceAId, await newId())).toBe(NO_FAILURE);
    expect(await insertRequest(b, sourceBId, await newId())).toBe(NO_FAILURE);
    expect([...(await sourcesWithPendingPreviews())].sort()).toEqual([sourceAId, sourceBId].sort());
    await admin.query("update mail_preview_requests set expires_at = now() - interval '1 minute'");
    expect(await sourcesWithPendingPreviews()).toEqual([]);
  });

  it('lists a source with expired content even when it is suspended', async () => {
    await admin.query('delete from mail_preview_requests');
    const suspendedId = await insertSource(a, 'preview-suspended@inbound.example.test');
    const receiptId = await newId();
    expect(await insertRequest(a, suspendedId, receiptId)).toBe(NO_FAILURE);
    await makeReady(a, await requestIdOf(receiptId));
    expect(await sourcesWithExpiredPreviews()).toEqual([]);
    await admin.query("update mail_sources set status = 'suspended' where id = $1", [suspendedId]);
    await admin.query("update mail_preview_requests set expires_at = now() - interval '1 minute'");
    expect(await sourcesWithExpiredPreviews()).toEqual([suspendedId]);
  });
});
