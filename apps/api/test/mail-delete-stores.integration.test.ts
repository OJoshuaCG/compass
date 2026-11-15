import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  PgMailDeleteRequestStore,
  PgMailDeleteWorkStore,
} from '../src/modules/inbound-codes/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asOrganizationId, asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase, openInboundWorkerPool } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Almacenes de borrado de correo contra PostgreSQL real: el lado de la API con el rol de la aplicación
 * (`iam_app`) y el lado del worker con `iam_inbound_worker` (sin BYPASSRLS, permisos de columna acotados).
 * Cubre el SQL que las pruebas unitarias no ejercitan: la petición pendiente única por recibo, la caducidad
 * de 24 horas y que el worker solo cierra filas todavía pendientes (odd/tasks/inbound-mail-delete.md, D8).
 */

const MAILBOX_UID_VALIDITY = 777;
const MAILBOX_UID = 42;
const NOW = new Date('2026-11-14T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const LONG_AGO = new Date('2000-01-01T00:00:00.000Z');
const BATCH_LIMIT = 10;

let db: TestDatabase;
let workerPool: Pool;
let appUow: PgUnitOfWork;
let requestStore: PgMailDeleteRequestStore;
let workStore: PgMailDeleteWorkStore;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => appUow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly sourceId: string;
  readonly creator: ReturnType<typeof asUserId>;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  workerPool = openInboundWorkerPool(db);
  appUow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  const workerUow = new PgUnitOfWork(workerPool, requestContext, workerPool);
  requestStore = new PgMailDeleteRequestStore(appUow);
  workStore = new PgMailDeleteWorkStore(
    workerPool,
    new PgTenantScope(requestContext, workerUow),
    workerUow,
    ids,
  );
});

afterAll(async () => {
  await workerPool.end();
  await db.close();
});

async function insertOne(sql: string, params: readonly unknown[]): Promise<string> {
  const result = await db.admin.query<{ id: string }>(sql, [...params]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedFixture(slug: string, sourceStatus = 'active'): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const creator = await insertOne(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Persona', 0, 'active') returning id`,
    [organization, `creator-${slug}@example.test`],
  );
  const sourceId = await insertOne(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by, status)
     values ($1, 'mail', $2, 'Buzón', $3, $4) returning id`,
    [organization, `${slug}@example.test`, creator, sourceStatus],
  );
  return { organization, sourceId, creator: asUserId(creator) };
}

/** Un recibo en cuarentena basta: el borrado solo necesita su posición en el buzón. */
function seedReceipt(fixture: Fixture, withPosition = true): Promise<string> {
  return insertOne(
    `insert into inbound_receipts
       (organization_id, source_id, message_fingerprint, outcome, reason, received_at,
        mailbox_uid_validity, mailbox_uid)
     values ($1, $2, $3, 'quarantined', 'DKIM_FAILED', $4, $5, $6) returning id`,
    [
      fixture.organization,
      fixture.sourceId,
      `fp-${ids.next()}`,
      NOW,
      withPosition ? MAILBOX_UID_VALIDITY : null,
      withPosition ? MAILBOX_UID : null,
    ],
  );
}

function newRequest(fixture: Fixture, receiptId: string) {
  return {
    receiptId,
    sourceId: fixture.sourceId,
    mailboxUidValidity: MAILBOX_UID_VALIDITY,
    mailboxUid: MAILBOX_UID,
    requestedBy: fixture.creator,
  };
}

const sourceRef = (fixture: Fixture) => ({
  organizationId: asOrganizationId(fixture.organization),
  sourceId: fixture.sourceId,
});

/** Fija `requested_at` como administrador (fixture): la API siempre lo deja en `now()`. */
async function backdate(receiptId: string, requestedAt: Date): Promise<void> {
  await db.admin.query('update mail_delete_requests set requested_at = $2 where receipt_id = $1', [
    receiptId,
    requestedAt,
  ]);
}

describe('PgMailDeleteRequestStore', () => {
  it('finds the target of a receipt of an active mail source, with its position and creator', async () => {
    const fixture = await seedFixture('del-target');
    const receiptId = await seedReceipt(fixture);

    const target = await inOrg(fixture.organization, () => requestStore.findTarget(receiptId));

    expect(target).toEqual({
      receiptId,
      sourceId: fixture.sourceId,
      sourceCreatedBy: fixture.creator,
      mailboxUidValidity: MAILBOX_UID_VALIDITY,
      mailboxUid: MAILBOX_UID,
    });
  });

  it('does not find the target when the source is not active', async () => {
    const fixture = await seedFixture('del-suspended', 'suspended');
    const receiptId = await seedReceipt(fixture);

    const target = await inOrg(fixture.organization, () => requestStore.findTarget(receiptId));

    expect(target).toBeNull();
  });

  it('does not find a receipt of another organization', async () => {
    const mine = await seedFixture('del-iso-a');
    const theirs = await seedFixture('del-iso-b');
    const theirReceipt = await seedReceipt(theirs);

    const target = await inOrg(mine.organization, () => requestStore.findTarget(theirReceipt));

    expect(target).toBeNull();
  });

  it('reports a receipt without a mailbox position as having null position', async () => {
    const fixture = await seedFixture('del-no-position');
    const receiptId = await seedReceipt(fixture, false);

    const target = await inOrg(fixture.organization, () => requestStore.findTarget(receiptId));

    expect(target).toMatchObject({ mailboxUidValidity: null, mailboxUid: null });
  });

  it('keeps one pending request per receipt and accepts a new one once it is closed', async () => {
    const fixture = await seedFixture('del-pending-once');
    const receiptId = await seedReceipt(fixture);

    const first = await inOrg(fixture.organization, () =>
      requestStore.insertPending(newRequest(fixture, receiptId)),
    );
    const repeated = await inOrg(fixture.organization, () =>
      requestStore.insertPending(newRequest(fixture, receiptId)),
    );
    await workStore.close(sourceRef(fixture), await onlyRequestId(receiptId), 'CONNECTION', NOW);
    const afterClose = await inOrg(fixture.organization, () =>
      requestStore.insertPending(newRequest(fixture, receiptId)),
    );

    expect(first).toBe('created');
    expect(repeated).toBe('already_pending');
    expect(afterClose).toBe('created');
  });

  it('returns the latest request status, and null when there is none', async () => {
    const fixture = await seedFixture('del-latest');
    const receiptId = await seedReceipt(fixture);
    const withoutRequest = await inOrg(fixture.organization, () =>
      requestStore.findLatest(receiptId),
    );
    await inOrg(fixture.organization, () =>
      requestStore.insertPending(newRequest(fixture, receiptId)),
    );

    const pending = await inOrg(fixture.organization, () => requestStore.findLatest(receiptId));

    expect(withoutRequest).toBeNull();
    expect(pending).toMatchObject({ status: 'pending', resultCode: null, completedAt: null });
  });
});

async function onlyRequestId(receiptId: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "select id from mail_delete_requests where receipt_id = $1 and status = 'pending'",
    [receiptId],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('no pending request');
  return id;
}

describe('PgMailDeleteWorkStore', () => {
  it('discovers only the sources with a pending request on an active source', async () => {
    const withPending = await seedFixture('del-work-discover');
    const withoutPending = await seedFixture('del-work-nothing');
    const suspended = await seedFixture('del-work-suspended', 'suspended');
    for (const fixture of [withPending, suspended]) {
      const receiptId = await seedReceipt(fixture);
      await inOrg(fixture.organization, () =>
        requestStore.insertPending(newRequest(fixture, receiptId)),
      );
    }

    const sources = await workStore.listSourcesWithPending();
    const sourceIds = sources.map((source) => source.sourceId);

    expect(sourceIds).toContain(withPending.sourceId);
    expect(sourceIds).not.toContain(withoutPending.sourceId);
    expect(sourceIds).not.toContain(suspended.sourceId);
  });

  it('lists pending requests oldest first, honoring the limit and the not-before bound', async () => {
    const fixture = await seedFixture('del-work-list');
    const receipts = [await seedReceipt(fixture), await seedReceipt(fixture)];
    for (const receiptId of receipts) {
      await inOrg(fixture.organization, () =>
        requestStore.insertPending(newRequest(fixture, receiptId)),
      );
    }
    const [older, newer] = receipts;
    if (older === undefined || newer === undefined) throw new Error('seed failed');
    await backdate(older, new Date(NOW.getTime() - 2 * HOUR_MS));
    await backdate(newer, new Date(NOW.getTime() - HOUR_MS));

    const all = await workStore.listPending(sourceRef(fixture), BATCH_LIMIT, LONG_AGO);
    const limited = await workStore.listPending(sourceRef(fixture), 1, LONG_AGO);
    const recentOnly = await workStore.listPending(
      sourceRef(fixture),
      BATCH_LIMIT,
      new Date(NOW.getTime() - 90 * 60 * 1000),
    );

    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      mailboxUidValidity: MAILBOX_UID_VALIDITY,
      mailboxUid: MAILBOX_UID,
    });
    expect(limited).toHaveLength(1);
    expect(recentOnly).toHaveLength(1);
    expect(recentOnly[0]?.requestId).not.toBe(all[0]?.requestId);
  });

  it('closes a pending request once and never overwrites an already closed one', async () => {
    const fixture = await seedFixture('del-work-close');
    const receiptId = await seedReceipt(fixture);
    await inOrg(fixture.organization, () =>
      requestStore.insertPending(newRequest(fixture, receiptId)),
    );
    const requestId = await onlyRequestId(receiptId);

    await workStore.close(sourceRef(fixture), requestId, 'DELETED', NOW);
    await workStore.close(sourceRef(fixture), requestId, 'UNEXPECTED', NOW);
    const status = await inOrg(fixture.organization, () => requestStore.findLatest(receiptId));

    expect(status).toMatchObject({ status: 'done', resultCode: 'DELETED' });
  });

  it('marks any other result as failed with its code', async () => {
    const fixture = await seedFixture('del-work-failed');
    const receiptId = await seedReceipt(fixture);
    await inOrg(fixture.organization, () =>
      requestStore.insertPending(newRequest(fixture, receiptId)),
    );

    await workStore.close(sourceRef(fixture), await onlyRequestId(receiptId), 'NOT_FOUND', NOW);
    const status = await inOrg(fixture.organization, () => requestStore.findLatest(receiptId));

    expect(status).toMatchObject({ status: 'failed', resultCode: 'NOT_FOUND' });
  });

  it('expires only the stale pending requests of the source, even when it is not active', async () => {
    const fixture = await seedFixture('del-work-expire', 'suspended');
    const staleReceipt = await seedReceipt(fixture);
    const freshReceipt = await seedReceipt(fixture);
    for (const receiptId of [staleReceipt, freshReceipt]) {
      await inOrg(fixture.organization, () =>
        requestStore.insertPending(newRequest(fixture, receiptId)),
      );
    }
    const cutoff = new Date(NOW.getTime() - 24 * HOUR_MS);
    await backdate(staleReceipt, new Date(cutoff.getTime() - HOUR_MS));

    const sources = await workStore.listSourcesWithStale(cutoff);
    const expired = await workStore.expireStale(sourceRef(fixture), cutoff, NOW);
    const staleStatus = await inOrg(fixture.organization, () =>
      requestStore.findLatest(staleReceipt),
    );
    const freshStatus = await inOrg(fixture.organization, () =>
      requestStore.findLatest(freshReceipt),
    );

    expect(sources.map((source) => source.sourceId)).toContain(fixture.sourceId);
    expect(expired).toBe(1);
    expect(staleStatus).toMatchObject({ status: 'failed', resultCode: 'EXPIRED' });
    expect(freshStatus).toMatchObject({ status: 'pending' });
  });

  it('does not let the worker role read the requests of other organizations', async () => {
    const mine = await seedFixture('del-work-iso-a');
    const theirs = await seedFixture('del-work-iso-b');
    const theirReceipt = await seedReceipt(theirs);
    await inOrg(theirs.organization, () =>
      requestStore.insertPending(newRequest(theirs, theirReceipt)),
    );

    // Fuente de la otra organización pedida con la organización propia: RLS no devuelve filas.
    const crossed = await workStore.listPending(
      { organizationId: asOrganizationId(mine.organization), sourceId: theirs.sourceId },
      BATCH_LIMIT,
      LONG_AGO,
    );

    expect(crossed).toEqual([]);
  });
});
