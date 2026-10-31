import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { PgUserDirectory } from '../src/modules/directory/index.js';
import { PgOrganizationLister } from '../src/modules/maintenance/index.js';
import { InMemoryMailer } from '../src/modules/notification/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import {
  OutboxHandlerRegistry,
  OutboxWorker,
  PgOutboxDeliveryReceipts,
  PgOutboxRepository,
} from '../src/modules/outbox/index.js';
import {
  EnqueuePendingTotpNotices,
  NotifyPendingTotpUnconfirmed,
  PENDING_TOTP_NOTICE_AFTER_MS,
  PENDING_TOTP_NOTICE_EVENT_TYPE,
  PENDING_TOTP_NOTICE_HANDLER_KEY,
  PgPendingTotpNoticeStore,
  PgTotpRepository,
  PgVaultCredentialRepository,
  pendingTotpNoticeHandlerKey,
} from '../src/modules/vault/index.js';
import type { PendingTotpNoticeStore } from '../src/modules/vault/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const KEY_MARKER = 'JBSWY3DPEHPK3PXP';

interface SeededOrganization {
  readonly organizationId: string;
  readonly rootId: string;
  readonly registrantId: string;
  readonly registrantEmail: string;
  readonly accountId: string;
}

interface PendingTotpSeed {
  readonly registeredHoursAgo: number;
  readonly status?: 'pending' | 'verified' | 'retired';
  readonly credentialArchived?: boolean;
  readonly registeredBy?: string;
}

let db: TestDatabase;
let orgA: SeededOrganization;
let orgB: SeededOrganization;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let mailer: InMemoryMailer;

async function seedOrganization(slug: string): Promise<SeededOrganization> {
  const organizationId = await db.seedOrganization(slug);
  const root = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, locale) values ($1, $2, 'Root', 0, 'active', 'en-US') returning id",
    [organizationId, `root@${slug}.test`],
  );
  const rootId = root.rows[0]?.id;
  if (rootId === undefined) throw new Error('seed failed');
  const registrantEmail = `luis@${slug}.test`;
  const registrant = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, managed_by, locale) values ($1, $2, 'Luis Operador', 3, 'active', $3, 'es-MX') returning id",
    [organizationId, registrantEmail, rootId],
  );
  const registrantId = registrant.rows[0]?.id;
  if (registrantId === undefined) throw new Error('seed failed');
  const account = await db.admin.query<{ id: string }>(
    `insert into accounts (organization_id, platform_id, display_name, created_by)
     values ($1, (select id from platforms where slug = 'custom' and organization_id is null), 'Cuenta de prueba', $2)
     returning id`,
    [organizationId, rootId],
  );
  const accountId = account.rows[0]?.id;
  if (accountId === undefined) throw new Error('seed failed');
  return { organizationId, rootId, registrantId, registrantEmail, accountId };
}

/** Siembra una credencial con su registro de segundo factor, con la antigüedad pedida. */
async function seedPendingTotp(
  organization: SeededOrganization,
  seed: PendingTotpSeed,
): Promise<string> {
  const status = seed.status ?? 'pending';
  const registeredAt = new Date(Date.now() - seed.registeredHoursAgo * MILLISECONDS_PER_HOUR);
  const credential = await db.admin.query<{ id: string }>(
    `insert into credentials (organization_id, account_id, label, kind, created_by, archived_at)
     values ($1, $2, 'etiqueta-secreta-de-credencial', 'password_totp', $3, $4)
     returning id`,
    [
      organization.organizationId,
      organization.accountId,
      organization.rootId,
      seed.credentialArchived === true ? new Date() : null,
    ],
  );
  const credentialId = credential.rows[0]?.id;
  if (credentialId === undefined) throw new Error('seed failed');
  await db.admin.query(
    `insert into credential_totp
       (organization_id, credential_id, secret_version, status, algorithm, digits, period_seconds,
        registered_by, registered_at, verified_at, retired_at)
     values ($1, $2, 1, $3, 'SHA1', 6, 30, $4, $5, $6, $7)`,
    [
      organization.organizationId,
      credentialId,
      status,
      seed.registeredBy ?? organization.registrantId,
      registeredAt,
      status === 'verified' ? registeredAt : null,
      status === 'retired' ? registeredAt : null,
    ],
  );
  return credentialId;
}

function buildSweep(store?: PendingTotpNoticeStore): EnqueuePendingTotpNotices {
  return new EnqueuePendingTotpNotices({
    organizations: new PgOrganizationLister(db.appPool),
    store: store ?? new PgPendingTotpNoticeStore(uow),
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock: new SystemClock(),
  });
}

function buildWorker(): OutboxWorker {
  const receipts = new PgOutboxDeliveryReceipts(uow, uow);
  const handler = new NotifyPendingTotpUnconfirmed({
    directory: new PgUserDirectory(uow),
    totps: new PgTotpRepository(uow),
    credentials: new PgVaultCredentialRepository(uow),
    mailer,
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        receipts.wasDelivered(eventId, pendingTotpNoticeHandlerKey(recipientId)),
      markDelivered: (eventId, recipientId) =>
        receipts.markDelivered(eventId, pendingTotpNoticeHandlerKey(recipientId)),
    },
  });
  const registry = new OutboxHandlerRegistry();
  registry.register(PENDING_TOTP_NOTICE_EVENT_TYPE, (event) =>
    handler.handle({ eventId: event.id, payload: event.payload }),
  );
  return new OutboxWorker({
    organizations: new PgOrganizationLister(db.appPool),
    repository: new PgOutboxRepository(uow),
    scope: new PgTenantScope(requestContext, uow),
    handlers: registry,
    ids: new UuidV7Generator(),
    clock: new SystemClock(),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
}

interface QueuedEvent {
  id: string;
  organization_id: string;
  payload: Record<string, unknown>;
  published_at: Date | null;
}

async function queuedEvents(organizationId?: string): Promise<QueuedEvent[]> {
  const result = await db.admin.query<QueuedEvent>(
    `select id, organization_id, payload, published_at
       from outbox_events
      where type = $1 and ($2::uuid is null or organization_id = $2::uuid)
      order by id`,
    [PENDING_TOTP_NOTICE_EVENT_TYPE, organizationId ?? null],
  );
  return result.rows;
}

async function noticeMarkOf(credentialId: string): Promise<Date | null> {
  const result = await db.admin.query<{ pending_notice_at: Date | null }>(
    'select pending_notice_at from credential_totp where credential_id = $1',
    [credentialId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('totp row not found');
  return row.pending_notice_at;
}

async function receiptCount(eventId: string): Promise<number> {
  const result = await db.admin.query(
    'select 1 from outbox_deliveries where event_id = $1 and handler_key like $2',
    [eventId, `${PENDING_TOTP_NOTICE_HANDLER_KEY}:%`],
  );
  return result.rowCount ?? 0;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  orgA = await seedOrganization('pending-a');
  orgB = await seedOrganization('pending-b');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  mailer = new InMemoryMailer();
  await db.admin.query('delete from outbox_events');
  await db.admin.query('delete from outbox_deliveries');
  await db.admin.query('delete from credential_totp');
  await db.admin.query('delete from credentials');
  await db.admin.query("update users set status = 'active' where rank = 3");
});

describe('pending second factor notice (N1a) against PostgreSQL', () => {
  it('enqueues a notice only for pending registrations of 24 hours or more and marks them', async () => {
    const overdue = await seedPendingTotp(orgA, { registeredHoursAgo: 25 });
    const justOverdue = await seedPendingTotp(orgA, {
      registeredHoursAgo: PENDING_TOTP_NOTICE_AFTER_MS / MILLISECONDS_PER_HOUR + 0.01,
    });
    const recent = await seedPendingTotp(orgA, { registeredHoursAgo: 23 });
    const verified = await seedPendingTotp(orgA, { registeredHoursAgo: 48, status: 'verified' });
    const retired = await seedPendingTotp(orgA, { registeredHoursAgo: 48, status: 'retired' });
    const archived = await seedPendingTotp(orgA, {
      registeredHoursAgo: 48,
      credentialArchived: true,
    });

    const summary = await buildSweep().execute();

    expect(summary).toMatchObject({ enqueued: 2, failedOrganizations: 0 });
    expect(await queuedEvents()).toHaveLength(2);
    expect(await noticeMarkOf(overdue)).not.toBeNull();
    expect(await noticeMarkOf(justOverdue)).not.toBeNull();
    for (const untouched of [recent, verified, retired, archived]) {
      expect(await noticeMarkOf(untouched)).toBeNull();
    }
  });

  it('writes only ids and a date in the payload, never a name or a secret', async () => {
    const credentialId = await seedPendingTotp(orgA, { registeredHoursAgo: 30 });

    await buildSweep().execute();

    const [event] = await queuedEvents();
    expect(event?.payload).toBeDefined();
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual([
      'credentialId',
      'registeredAt',
      'registeredBy',
    ]);
    expect(event?.payload).toMatchObject({
      credentialId,
      registeredBy: orgA.registrantId,
    });
    const serialized = JSON.stringify(event?.payload);
    expect(serialized).not.toContain('etiqueta-secreta-de-credencial');
    expect(serialized).not.toContain(KEY_MARKER);
    expect(serialized).not.toContain('@');
  });

  it('notifies each pending registration once, however many sweeps run', async () => {
    await seedPendingTotp(orgA, { registeredHoursAgo: 30 });

    await buildSweep().execute();
    const second = await buildSweep().execute();
    const third = await buildSweep().execute();

    expect(second.enqueued).toBe(0);
    expect(third.enqueued).toBe(0);
    expect(await queuedEvents()).toHaveLength(1);
  });

  it('leaves neither the mark nor the event when writing the event fails (same transaction)', async () => {
    const credentialId = await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    const realStore = new PgPendingTotpNoticeStore(uow);
    const failingStore: PendingTotpNoticeStore = {
      claimDue: (registeredBefore, noticeAt, limit) =>
        realStore.claimDue(registeredBefore, noticeAt, limit),
      enqueue: () => Promise.reject(new Error('outbox write failed')),
    };

    const summary = await buildSweep(failingStore).execute();

    expect(summary.failedOrganizations).toBeGreaterThanOrEqual(1);
    expect(await noticeMarkOf(credentialId)).toBeNull();
    expect(await queuedEvents()).toHaveLength(0);

    // El siguiente barrido, ya sin el fallo, sí lo encola.
    const retry = await buildSweep().execute();
    expect(retry.enqueued).toBe(1);
  });

  it('opens a new 24 hour window after a re-registration clears the mark', async () => {
    const credentialId = await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    await buildSweep().execute();

    // Un re-registro deja `pending`, con `registered_at` nuevo y sin la marca (ver `PgTotpRepository.replace`).
    await db.admin.query(
      "update credential_totp set registered_at = now() - interval '1 hour', pending_notice_at = null where credential_id = $1",
      [credentialId],
    );
    expect((await buildSweep().execute()).enqueued).toBe(0);

    await db.admin.query(
      "update credential_totp set registered_at = now() - interval '25 hours' where credential_id = $1",
      [credentialId],
    );
    expect((await buildSweep().execute()).enqueued).toBe(1);
    expect(await queuedEvents()).toHaveLength(2);
  });

  it('emails only the person who registered it and marks the event as delivered', async () => {
    await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    await buildSweep().execute();
    const [event] = await queuedEvents();

    const summary = await buildWorker().runOnce();

    expect(summary).toMatchObject({ published: 1, retryScheduled: 0, deadLettered: 0 });
    expect(mailer.pendingTotpNotices).toHaveLength(1);
    expect(mailer.pendingTotpNotices[0]).toMatchObject({
      to: orgA.registrantEmail,
      locale: 'es-MX',
      recipientDisplayName: 'Luis Operador',
    });
    expect(await receiptCount(event?.id ?? '')).toBe(1);
    expect((await queuedEvents())[0]?.published_at).not.toBeNull();
  });

  it('does not resend when the same event is delivered again', async () => {
    await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    await buildSweep().execute();
    const worker = buildWorker();
    await worker.runOnce();
    const [event] = await queuedEvents();

    // Simula una segunda entrega (p. ej. se perdió la marca de publicado).
    await db.admin.query('update outbox_events set published_at = null where id = $1', [event?.id]);
    const second = await worker.runOnce();

    expect(second.published).toBe(1);
    expect(mailer.pendingTotpNotices).toHaveLength(1);
  });

  it('sends nothing, and still closes the event, when the second factor was confirmed before delivery', async () => {
    const credentialId = await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    await buildSweep().execute();
    await db.admin.query(
      "update credential_totp set status = 'verified', verified_at = now() where credential_id = $1",
      [credentialId],
    );

    const summary = await buildWorker().runOnce();

    expect(summary).toMatchObject({ published: 1, retryScheduled: 0 });
    expect(mailer.pendingTotpNotices).toHaveLength(0);
  });

  it('sends nothing, and still closes the event, when the credential was archived after the sweep', async () => {
    const credentialId = await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    await buildSweep().execute();
    await db.admin.query('update credentials set archived_at = now() where id = $1', [
      credentialId,
    ]);

    const summary = await buildWorker().runOnce();

    expect(summary).toMatchObject({ published: 1, retryScheduled: 0 });
    expect(mailer.pendingTotpNotices).toHaveLength(0);
  });

  it('sends nothing, and still closes the event, when the registrant is no longer active', async () => {
    await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    await buildSweep().execute();
    await db.admin.query("update users set status = 'suspended' where id = $1", [
      orgA.registrantId,
    ]);

    const summary = await buildWorker().runOnce();

    expect(summary).toMatchObject({ published: 1, retryScheduled: 0 });
    expect(mailer.pendingTotpNotices).toHaveLength(0);
  });

  it('retries without a receipt when the mail provider fails, and sends once it recovers', async () => {
    await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    await buildSweep().execute();
    const [event] = await queuedEvents();
    mailer.failNext = true;
    const worker = buildWorker();

    const first = await worker.runOnce();

    expect(first).toMatchObject({ published: 0, retryScheduled: 1 });
    expect(await receiptCount(event?.id ?? '')).toBe(0);

    await db.admin.query('update outbox_events set next_attempt_at = now() where id = $1', [
      event?.id,
    ]);
    const second = await worker.runOnce();

    expect(second.published).toBe(1);
    expect(mailer.pendingTotpNotices).toHaveLength(1);
  });

  it('keeps each organization isolated: events, marks and emails never cross', async () => {
    const credentialA = await seedPendingTotp(orgA, { registeredHoursAgo: 30 });
    const credentialB = await seedPendingTotp(orgB, { registeredHoursAgo: 30 });

    await buildSweep().execute();
    await buildWorker().runOnce();

    const eventsOfA = await queuedEvents(orgA.organizationId);
    const eventsOfB = await queuedEvents(orgB.organizationId);
    expect(eventsOfA).toHaveLength(1);
    expect(eventsOfB).toHaveLength(1);
    expect(eventsOfA[0]?.payload).toMatchObject({ credentialId: credentialA });
    expect(eventsOfB[0]?.payload).toMatchObject({ credentialId: credentialB });
    expect(mailer.pendingTotpNotices.map((sent) => sent.to).sort()).toEqual(
      [orgA.registrantEmail, orgB.registrantEmail].sort(),
    );
  });
});
