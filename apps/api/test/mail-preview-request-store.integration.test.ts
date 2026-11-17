import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgMailPreviewRequestStore } from '../src/modules/inbound-codes/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Almacén de peticiones de vista previa con el rol de la aplicación (`iam_app`): cada persona tiene su propia
 * petición del mismo correo, y solo ella consulta su estado o recibe el contenido (odd/tasks/inbound-mail-delete.md,
 * L16).
 */

const MAILBOX_UID_VALIDITY = 777;
const MAILBOX_UID = 42;
const LIFETIME_MS = 15 * 60 * 1000;
const NOW = new Date('2026-11-14T12:00:00.000Z');

let db: TestDatabase;
let uow: PgUnitOfWork;
let store: PgMailPreviewRequestStore;
const requestContext = new AsyncLocalRequestContext();

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly sourceId: string;
  readonly firstPerson: ReturnType<typeof asUserId>;
  readonly secondPerson: ReturnType<typeof asUserId>;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  store = new PgMailPreviewRequestStore(uow);
});

afterAll(async () => {
  await db.close();
});

/** La Raíz (rank 0) no tiene responsable; cualquier otro rango lo necesita (`users_root_has_no_manager`). */
async function insertUser(
  organization: string,
  email: string,
  rank: number,
  managerId: string | null,
): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, status, managed_by, created_by)
     values ($1, $2, 'Persona', $3, 'active', $4, $4) returning id`,
    [organization, email, rank, managerId],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedFixture(slug: string): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  await db.admin.query(
    "insert into data_keys (organization_id, version, wrapped_dek, kms_key_ref) values ($1, 1, '\\x0102', 'local/test')",
    [organization],
  );
  const first = await insertUser(organization, `first-${slug}@example.test`, 0, null);
  const second = await insertUser(organization, `second-${slug}@example.test`, 1, first);
  const source = await db.admin.query<{ id: string }>(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by)
     values ($1, 'mail', $2, 'Buzón', $3) returning id`,
    [organization, `${slug}@example.test`, first],
  );
  const sourceId = source.rows[0]?.id;
  if (sourceId === undefined) throw new Error('seed failed');
  return {
    organization,
    sourceId,
    firstPerson: asUserId(first),
    secondPerson: asUserId(second),
  };
}

function newRequest(fixture: Fixture, receiptId: string, requestedBy: Fixture['firstPerson']) {
  return {
    receiptId,
    sourceId: fixture.sourceId,
    kind: 'subject' as const,
    mailboxUidValidity: MAILBOX_UID_VALIDITY,
    mailboxUid: MAILBOX_UID,
    requestedBy,
    expiresAt: new Date(NOW.getTime() + LIFETIME_MS),
  };
}

/** Deja listas, con contenido ficticio, todas las peticiones del recibo: lo hace el administrador (fixture). */
async function makeAllReady(receiptId: string): Promise<void> {
  await db.admin.query(
    `update mail_preview_requests
        set status = 'ready', result_code = 'READY', completed_at = $2,
            ciphertext = decode(repeat('ab', 32), 'hex'), nonce = decode(repeat('cd', 12), 'hex'),
            dek_version = 1
      where receipt_id = $1`,
    [receiptId, NOW],
  );
}

const newReceiptId = async (): Promise<string> => {
  const result = await db.admin.query<{ id: string }>('select uuid_generate_v7() as id');
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('no id');
  return id;
};

describe('PgMailPreviewRequestStore', () => {
  it('da a cada persona su propia petición del mismo correo y repite solo para la misma persona', async () => {
    const fixture = await seedFixture('preview-per-person');
    const receiptId = await newReceiptId();

    const first = await inOrg(fixture.organization, () =>
      store.insertPending(newRequest(fixture, receiptId, fixture.firstPerson), NOW),
    );
    const second = await inOrg(fixture.organization, () =>
      store.insertPending(newRequest(fixture, receiptId, fixture.secondPerson), NOW),
    );
    const repeated = await inOrg(fixture.organization, () =>
      store.insertPending(newRequest(fixture, receiptId, fixture.firstPerson), NOW),
    );

    expect(first).toBe('created');
    expect(second).toBe('created');
    expect(repeated).toBe('already_pending');
  });

  it('entrega el contenido solo a quien lo pidió, una sola vez, sin quitárselo a la otra persona', async () => {
    const fixture = await seedFixture('preview-take');
    const receiptId = await newReceiptId();
    await inOrg(fixture.organization, () =>
      store.insertPending(newRequest(fixture, receiptId, fixture.firstPerson), NOW),
    );
    await inOrg(fixture.organization, () =>
      store.insertPending(newRequest(fixture, receiptId, fixture.secondPerson), NOW),
    );
    await makeAllReady(receiptId);

    const takenByFirst = await inOrg(fixture.organization, () =>
      store.takeReady(receiptId, 'subject', fixture.firstPerson, NOW),
    );
    const takenByFirstAgain = await inOrg(fixture.organization, () =>
      store.takeReady(receiptId, 'subject', fixture.firstPerson, NOW),
    );
    const takenBySecond = await inOrg(fixture.organization, () =>
      store.takeReady(receiptId, 'subject', fixture.secondPerson, NOW),
    );

    expect(takenByFirst).not.toBeNull();
    expect(takenByFirstAgain).toBeNull();
    expect(takenBySecond).not.toBeNull();
    expect(takenBySecond?.requestId).not.toBe(takenByFirst?.requestId);
  });

  it('el estado de una persona nunca muestra la petición de otra', async () => {
    const fixture = await seedFixture('preview-status');
    const receiptId = await newReceiptId();
    await inOrg(fixture.organization, () =>
      store.insertPending(newRequest(fixture, receiptId, fixture.firstPerson), NOW),
    );

    const own = await inOrg(fixture.organization, () =>
      store.findLatest(receiptId, 'subject', fixture.firstPerson, NOW),
    );
    const other = await inOrg(fixture.organization, () =>
      store.findLatest(receiptId, 'subject', fixture.secondPerson, NOW),
    );

    expect(own).toMatchObject({ status: 'pending' });
    expect(other).toBeNull();
  });
});
