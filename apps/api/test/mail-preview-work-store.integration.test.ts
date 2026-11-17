import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  DataKeyResolver,
  DekCache,
  LocalKeyManagement,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from '../src/modules/crypto/index.js';
import {
  PgMailPreviewWorkStore,
  ReadOnlyDataKeyRepository,
  inboundItemContext,
} from '../src/modules/inbound-codes/index.js';
import { mailPreviewContext } from '../src/modules/inbound-codes/domain/mail-preview.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asOrganizationId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase, openInboundWorkerPool } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Almacén del worker de vistas previas contra PostgreSQL real, con el rol `iam_inbound_worker` (sin BYPASSRLS):
 * descubrimiento, cifrado antes de tocar la base, cierre solo de filas pendientes y purga de lo vencido
 * (odd/tasks/inbound-mail-delete.md, D8). La API es quien descifra al entregar: aquí se usa su cifrador para
 * comprobar que el contenido guardado solo se abre con el contexto de esa petición.
 */

const MAILBOX_UID_VALIDITY = 777;
const MAILBOX_UID = 42;
const NOW = new Date('2026-11-14T12:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const BATCH_LIMIT = 10;
const PREVIEW_TEXT = 'Tu código de acceso es 123456';

let db: TestDatabase;
let workerPool: Pool;
let kekDir: string;
let appUow: PgUnitOfWork;
let appCipher: SecretCipher;
let workStore: PgMailPreviewWorkStore;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

const inAppOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => appUow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly sourceId: string;
  readonly person: string;
}

const minutesFromNow = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  workerPool = openInboundWorkerPool(db);
  kekDir = mkdtempSync(join(tmpdir(), 'iam-kek-'));
  const clock = new SystemClock();
  const kms = new LocalKeyManagement({ keyFilePath: join(kekDir, 'kek.key'), nodeEnv: 'test' });

  appUow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  appCipher = new SecretCipher({
    keys: new DataKeyResolver({
      repository: new PgDataKeyRepository(appUow),
      kms,
      cache: new DekCache({ clock }),
      clock,
      independently: (fn) => appUow.run(fn),
    }),
    primitives: new NodeCryptoPrimitives(),
  });

  const workerUow = new PgUnitOfWork(workerPool, requestContext, workerPool);
  const workerCipher = new SecretCipher({
    keys: new DataKeyResolver({
      repository: new ReadOnlyDataKeyRepository(workerUow),
      kms,
      cache: new DekCache({ clock }),
      clock,
      independently: (fn) => workerUow.runIndependent(fn),
    }),
    primitives: new NodeCryptoPrimitives(),
  });
  workStore = new PgMailPreviewWorkStore(
    workerPool,
    new PgTenantScope(requestContext, workerUow),
    workerUow,
    workerCipher,
    ids,
  );
});

afterAll(async () => {
  await workerPool.end();
  await db.close();
  rmSync(kekDir, { recursive: true, force: true });
});

async function insertOne(sql: string, params: readonly unknown[]): Promise<string> {
  const result = await db.admin.query<{ id: string }>(sql, [...params]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedFixture(slug: string, sourceStatus = 'active'): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const person = await insertOne(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Persona', 0, 'active') returning id`,
    [organization, `person-${slug}@example.test`],
  );
  const sourceId = await insertOne(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by, status)
     values ($1, 'mail', $2, 'Buzón', $3, $4) returning id`,
    [organization, `${slug}@example.test`, person, sourceStatus],
  );
  // La API crea la DEK de la organización; el worker solo la lee.
  await inAppOrg(organization, () =>
    appCipher.encrypt(
      inboundItemContext(asOrganizationId(organization), sourceId),
      new TextEncoder().encode('x'),
    ),
  );
  return { organization, sourceId, person };
}

/** Petición pendiente puesta por el fixture (administrador), con el vencimiento que pida la prueba. */
function seedPending(fixture: Fixture, expiresAt: Date): Promise<string> {
  return insertOne(
    `insert into mail_preview_requests
       (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, kind, requested_by,
        expires_at)
     values ($1, $2, uuid_generate_v7(), $3, $4, 'subject', $5, $6) returning id`,
    [
      fixture.organization,
      fixture.sourceId,
      MAILBOX_UID_VALIDITY,
      MAILBOX_UID,
      fixture.person,
      expiresAt,
    ],
  );
}

const sourceRef = (fixture: Fixture) => ({
  organizationId: asOrganizationId(fixture.organization),
  sourceId: fixture.sourceId,
});

interface StoredRow {
  readonly status: string;
  readonly result_code: string | null;
  readonly ciphertext: Buffer | null;
  readonly nonce: Buffer | null;
  readonly dek_version: number | null;
  readonly expires_at: Date;
}

async function storedRow(requestId: string): Promise<StoredRow> {
  const result = await db.admin.query<StoredRow>(
    `select status, result_code, ciphertext, nonce, dek_version, expires_at
       from mail_preview_requests where id = $1`,
    [requestId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('row not found');
  return row;
}

describe('PgMailPreviewWorkStore', () => {
  it('discovers only active sources with a pending request that has not expired', async () => {
    const live = await seedFixture('prev-work-live');
    const expired = await seedFixture('prev-work-expired');
    const suspended = await seedFixture('prev-work-suspended', 'suspended');
    await seedPending(live, minutesFromNow(10));
    await seedPending(expired, minutesFromNow(-1));
    await seedPending(suspended, minutesFromNow(10));

    const sources = await workStore.listSourcesWithPending(NOW);
    const sourceIds = sources.map((source) => source.sourceId);

    expect(sourceIds).toContain(live.sourceId);
    expect(sourceIds).not.toContain(expired.sourceId);
    expect(sourceIds).not.toContain(suspended.sourceId);
  });

  it('lists pending requests that have not expired, ordered by expiry, up to the limit', async () => {
    const fixture = await seedFixture('prev-work-list');
    const later = await seedPending(fixture, minutesFromNow(14));
    const sooner = await seedPending(fixture, minutesFromNow(5));
    await seedPending(fixture, minutesFromNow(-3));

    const all = await workStore.listPending(sourceRef(fixture), BATCH_LIMIT, NOW);
    const limited = await workStore.listPending(sourceRef(fixture), 1, NOW);

    expect(all.map((pending) => pending.requestId)).toEqual([sooner, later]);
    expect(all[0]).toMatchObject({
      kind: 'subject',
      mailboxUidValidity: MAILBOX_UID_VALIDITY,
      mailboxUid: MAILBOX_UID,
    });
    expect(limited).toHaveLength(1);
  });

  it('stores the content encrypted, never in clear, and only the request context opens it', async () => {
    const fixture = await seedFixture('prev-work-complete');
    const requestId = await seedPending(fixture, minutesFromNow(1));
    const newExpiry = minutesFromNow(15);

    const saved = await workStore.complete(
      sourceRef(fixture),
      requestId,
      PREVIEW_TEXT,
      newExpiry,
      NOW,
    );
    const row = await storedRow(requestId);

    expect(saved).toBe(true);
    expect(row).toMatchObject({ status: 'ready', result_code: 'READY' });
    expect(row.expires_at.getTime()).toBe(newExpiry.getTime());
    if (row.ciphertext === null || row.nonce === null || row.dek_version === null) {
      throw new Error('content was not stored');
    }
    expect(row.ciphertext.includes(Buffer.from(PREVIEW_TEXT))).toBe(false);

    const secret = {
      ciphertext: new Uint8Array(row.ciphertext),
      nonce: new Uint8Array(row.nonce),
      dekVersion: row.dek_version,
    };
    const opened = await inAppOrg(fixture.organization, () =>
      appCipher.decrypt(
        mailPreviewContext(asOrganizationId(fixture.organization), requestId),
        secret,
      ),
    );
    const openedWithOtherRequest = await inAppOrg(fixture.organization, () =>
      appCipher.decrypt(
        mailPreviewContext(asOrganizationId(fixture.organization), ids.next()),
        secret,
      ),
    );
    expect(opened.ok).toBe(true);
    expect(opened.ok ? new TextDecoder().decode(opened.value) : '').toBe(PREVIEW_TEXT);
    expect(openedWithOtherRequest.ok).toBe(false);
  });

  it('does not revive a request that expired while the message was downloading', async () => {
    const fixture = await seedFixture('prev-work-late');
    const requestId = await seedPending(fixture, minutesFromNow(-1));

    const saved = await workStore.complete(
      sourceRef(fixture),
      requestId,
      PREVIEW_TEXT,
      minutesFromNow(15),
      NOW,
    );
    const row = await storedRow(requestId);

    expect(saved).toBe(false);
    expect(row).toMatchObject({ status: 'pending', ciphertext: null });
  });

  it('does not overwrite a request another pass already closed', async () => {
    const fixture = await seedFixture('prev-work-closed');
    const requestId = await seedPending(fixture, minutesFromNow(10));

    await workStore.fail(sourceRef(fixture), requestId, 'NOT_FOUND', NOW);
    const savedAfterFail = await workStore.complete(
      sourceRef(fixture),
      requestId,
      PREVIEW_TEXT,
      minutesFromNow(15),
      NOW,
    );
    await workStore.fail(sourceRef(fixture), requestId, 'UNEXPECTED', NOW);
    const row = await storedRow(requestId);

    expect(savedAfterFail).toBe(false);
    expect(row).toMatchObject({ status: 'failed', result_code: 'NOT_FOUND', ciphertext: null });
  });

  it('purges expired rows of the source, with their content, even when the source is not active', async () => {
    const fixture = await seedFixture('prev-work-purge', 'suspended');
    const expiredPending = await seedPending(fixture, minutesFromNow(-5));
    const stillValid = await seedPending(fixture, minutesFromNow(10));

    const sources = await workStore.listSourcesWithExpired(NOW);
    const purged = await workStore.purgeExpired(sourceRef(fixture), NOW);
    const remaining = await db.admin.query<{ id: string }>(
      'select id from mail_preview_requests where source_id = $1',
      [fixture.sourceId],
    );

    expect(sources.map((source) => source.sourceId)).toContain(fixture.sourceId);
    expect(purged).toBe(1);
    expect(remaining.rows.map((row) => row.id)).toEqual([stillValid]);
    expect(remaining.rows.map((row) => row.id)).not.toContain(expiredPending);
  });

  it('does not let the worker role touch the requests of another organization', async () => {
    const mine = await seedFixture('prev-work-iso-a');
    const theirs = await seedFixture('prev-work-iso-b');
    const theirRequest = await seedPending(theirs, minutesFromNow(10));

    const crossedSource = {
      organizationId: asOrganizationId(mine.organization),
      sourceId: theirs.sourceId,
    };
    const listed = await workStore.listPending(crossedSource, BATCH_LIMIT, NOW);
    await workStore.fail(crossedSource, theirRequest, 'UNEXPECTED', NOW);
    const row = await storedRow(theirRequest);

    expect(listed).toEqual([]);
    expect(row.status).toBe('pending');
  });
});
