import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import {
  NotifyRankChanged,
  PgRankChangeNoticeQueue,
  PgUserDirectory,
  RANK_CHANGE_NOTICE_EVENT_TYPE,
  rankChangeNoticeHandlerKey,
} from '../src/modules/directory/index.js';
import { PgOrganizationLister } from '../src/modules/maintenance/index.js';
import { InMemoryMailer } from '../src/modules/notification/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import {
  OutboxHandlerRegistry,
  OutboxWorker,
  PgOutboxDeliveryReceipts,
  PgOutboxRepository,
} from '../src/modules/outbox/index.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const REASON_MARKER = 'confidential-reason-text';

interface SeededOrganization {
  readonly organizationId: string;
  readonly targetId: string;
  readonly targetEmail: string;
  readonly adminId: string;
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
    "insert into users (organization_id, email, display_name, rank, status) values ($1, $2, 'Root', 0, 'active') returning id",
    [organizationId, `root@${slug}.test`],
  );
  const rootId = root.rows[0]?.id;
  if (rootId === undefined) throw new Error('seed failed');
  const admin = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, managed_by) values ($1, $2, 'Ana Admin', 1, 'active', $3) returning id",
    [organizationId, `admin@${slug}.test`, rootId],
  );
  const target = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, managed_by, locale) values ($1, $2, 'Luis Lider', 2, 'active', $3, 'es-MX') returning id",
    [organizationId, `target@${slug}.test`, rootId],
  );
  const adminId = admin.rows[0]?.id;
  const targetId = target.rows[0]?.id;
  if (adminId === undefined || targetId === undefined) throw new Error('seed failed');
  return { organizationId, targetId, targetEmail: `target@${slug}.test`, adminId };
}

/** Escribe el aviso con la misma cola que usa `ManageUsers.changeRank`, en la transacción del cambio. */
async function enqueueNotice(
  organization: SeededOrganization,
  options: { readonly failAfterEnqueue?: boolean } = {},
): Promise<void> {
  await requestContext.run(contextFor(organization.organizationId), () =>
    uow.run(async () => {
      await new PgRankChangeNoticeQueue(uow).enqueue({
        targetId: asUserId(organization.targetId),
        changedBy: asUserId(organization.adminId),
        fromRank: 2,
        toRank: 3,
        changedAt: new Date(),
      });
      if (options.failAfterEnqueue === true) throw new Error('change failed after enqueue');
    }),
  );
}

async function eventIdOf(organization: SeededOrganization): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    'select id from outbox_events where organization_id = $1 and type = $2 order by id desc limit 1',
    [organization.organizationId, RANK_CHANGE_NOTICE_EVENT_TYPE],
  );
  const eventId = result.rows[0]?.id;
  if (eventId === undefined) throw new Error('the notice was not enqueued');
  return eventId;
}

function buildRegistry(options: { failAfterHandling?: boolean } = {}): OutboxHandlerRegistry {
  const receipts = new PgOutboxDeliveryReceipts(uow, uow);
  const handler = new NotifyRankChanged({
    directory: new PgUserDirectory(uow),
    mailer,
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        receipts.wasDelivered(eventId, rankChangeNoticeHandlerKey(recipientId)),
      markDelivered: (eventId, recipientId) =>
        receipts.markDelivered(eventId, rankChangeNoticeHandlerKey(recipientId)),
    },
  });
  const registry = new OutboxHandlerRegistry();
  registry.register(RANK_CHANGE_NOTICE_EVENT_TYPE, async (event) => {
    await handler.handle({ eventId: event.id, payload: event.payload });
    // Simula que el trabajador revierte DESPUÉS de enviar (plazo vencido, conexión perdida).
    if (options.failAfterHandling === true) throw new Error('worker transaction lost');
  });
  return registry;
}

function buildWorker(registry: OutboxHandlerRegistry): OutboxWorker {
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

async function receiptCount(eventId: string): Promise<number> {
  const result = await db.admin.query(
    'select 1 from outbox_deliveries where event_id = $1 and handler_key like $2',
    [eventId, 'directory.rank-change-notice:%'],
  );
  return result.rowCount ?? 0;
}

async function makeEventDueNow(eventId: string): Promise<void> {
  await db.admin.query('update outbox_events set next_attempt_at = now() where id = $1', [eventId]);
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  orgA = await seedOrganization('rank-notice-a');
  orgB = await seedOrganization('rank-notice-b');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  mailer = new InMemoryMailer();
  await db.admin.query('delete from outbox_events');
  await db.admin.query('delete from outbox_deliveries');
});

// SENSIBLE (revisión humana): aislamiento por organización y atomicidad del aviso con el cambio de rango.
describe('rank change notice (ADR 0035) against PostgreSQL', () => {
  it('writes the event in the same transaction and carries only ids and numbers', async () => {
    await enqueueNotice(orgA);

    const eventId = await eventIdOf(orgA);
    const row = await db.admin.query<{ payload: Record<string, unknown> }>(
      'select payload from outbox_events where id = $1',
      [eventId],
    );
    const payload = row.rows[0]?.payload ?? {};

    expect(Object.keys(payload).sort()).toEqual([
      'changedAt',
      'changedBy',
      'fromRank',
      'targetId',
      'toRank',
    ]);
    expect(JSON.stringify(payload)).not.toContain(REASON_MARKER);
    expect(JSON.stringify(payload)).not.toContain('@');
  });

  it('leaves no event when the transaction rolls back', async () => {
    await expect(enqueueNotice(orgA, { failAfterEnqueue: true })).rejects.toThrow(
      'change failed after enqueue',
    );

    const count = await db.admin.query(
      'select 1 from outbox_events where organization_id = $1 and type = $2',
      [orgA.organizationId, RANK_CHANGE_NOTICE_EVENT_TYPE],
    );
    expect(count.rowCount).toBe(0);
  });

  it('emails only the affected person, in their language, naming who made the change', async () => {
    const eventId = await (async () => {
      await enqueueNotice(orgA);
      return eventIdOf(orgA);
    })();

    const summary = await buildWorker(buildRegistry()).runOnce();

    expect(summary).toMatchObject({ published: 1, retryScheduled: 0, deadLettered: 0 });
    expect(mailer.rankChangeNotices).toHaveLength(1);
    expect(mailer.rankChangeNotices[0]).toMatchObject({
      to: orgA.targetEmail,
      locale: 'es-MX',
      changedByDisplayName: 'Ana Admin',
      fromRank: 2,
      toRank: 3,
    });
    expect(mailer.rankChangeNotices.some((sent) => sent.to === orgB.targetEmail)).toBe(false);
    expect(await receiptCount(eventId)).toBe(1);
  });

  it('keeps the receipt when the worker rolls back after sending, so the retry does not resend', async () => {
    await enqueueNotice(orgA);
    const eventId = await eventIdOf(orgA);

    const first = await buildWorker(buildRegistry({ failAfterHandling: true })).runOnce();

    expect(first).toMatchObject({ published: 0, retryScheduled: 1 });
    expect(mailer.rankChangeNotices).toHaveLength(1);
    expect(await receiptCount(eventId)).toBe(1);

    await makeEventDueNow(eventId);
    const second = await buildWorker(buildRegistry()).runOnce();

    expect(second.published).toBe(1);
    expect(mailer.rankChangeNotices).toHaveLength(1);
  });

  it('retries without a receipt when the mail provider fails, and sends once it recovers', async () => {
    await enqueueNotice(orgA);
    const eventId = await eventIdOf(orgA);
    mailer.failNext = true;
    const worker = buildWorker(buildRegistry());

    const first = await worker.runOnce();

    expect(first).toMatchObject({ published: 0, retryScheduled: 1 });
    expect(await receiptCount(eventId)).toBe(0);

    await makeEventDueNow(eventId);
    const second = await worker.runOnce();

    expect(second.published).toBe(1);
    expect(mailer.rankChangeNotices).toHaveLength(1);
  });

  it('keeps the receipts of each organization isolated', async () => {
    await enqueueNotice(orgA);
    const eventA = await eventIdOf(orgA);
    await enqueueNotice(orgB);
    const eventB = await eventIdOf(orgB);

    await buildWorker(buildRegistry()).runOnce();

    expect(mailer.rankChangeNotices.map((sent) => sent.to).sort()).toEqual(
      [orgA.targetEmail, orgB.targetEmail].sort(),
    );
    const visibleFromA = await requestContext.run(contextFor(orgA.organizationId), () =>
      uow.run(async () => {
        const receipts = new PgOutboxDeliveryReceipts(uow, uow);
        return {
          own: await receipts.wasDelivered(eventA, rankChangeNoticeHandlerKey(orgA.targetId)),
          foreign: await receipts.wasDelivered(eventB, rankChangeNoticeHandlerKey(orgB.targetId)),
        };
      }),
    );
    expect(visibleFromA).toEqual({ own: true, foreign: false });
  });
});
