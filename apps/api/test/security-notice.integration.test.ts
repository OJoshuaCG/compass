import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import {
  NotifySecurityNotice,
  PgSecurityNoticeQueue,
  SECURITY_NOTICE_EVENT_TYPE,
  securityNoticeHandlerKey,
} from '../src/modules/identity/index.js';
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
import { asUserId } from '../src/shared/kernel/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

interface SeededOrganization {
  readonly organizationId: string;
  readonly userId: string;
  readonly userEmail: string;
}

let db: TestDatabase;
let orgA: SeededOrganization;
let orgB: SeededOrganization;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let mailer: InMemoryMailer;

async function seedOrganization(slug: string): Promise<SeededOrganization> {
  const organizationId = await db.seedOrganization(slug);
  const user = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, locale) values ($1, $2, 'Raiz Dueña', 0, 'active', 'es-MX') returning id",
    [organizationId, `root@${slug}.test`],
  );
  const userId = user.rows[0]?.id;
  if (userId === undefined) throw new Error('seed failed');
  return { organizationId, userId, userEmail: `root@${slug}.test` };
}

/** Escribe el aviso con la misma cola que usa el flujo del código de emergencia, en su transacción. */
async function enqueueNotice(
  organization: SeededOrganization,
  options: { readonly failAfterEnqueue?: boolean } = {},
): Promise<void> {
  await requestContext.run(contextFor(organization.organizationId), () =>
    uow.run(async () => {
      await new PgSecurityNoticeQueue(uow).enqueue({
        userId: asUserId(organization.userId),
        kind: 'totp_removed',
        occurredAt: new Date(),
      });
      if (options.failAfterEnqueue === true) throw new Error('action failed after enqueue');
    }),
  );
}

async function eventIdOf(organization: SeededOrganization): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    'select id from outbox_events where organization_id = $1 and type = $2 order by id desc limit 1',
    [organization.organizationId, SECURITY_NOTICE_EVENT_TYPE],
  );
  const eventId = result.rows[0]?.id;
  if (eventId === undefined) throw new Error('the notice was not enqueued');
  return eventId;
}

function buildRegistry(options: { failAfterHandling?: boolean } = {}): OutboxHandlerRegistry {
  const receipts = new PgOutboxDeliveryReceipts(uow, uow);
  const handler = new NotifySecurityNotice({
    directory: new PgUserDirectory(uow),
    mailer,
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        receipts.wasDelivered(eventId, securityNoticeHandlerKey(recipientId)),
      markDelivered: (eventId, recipientId) =>
        receipts.markDelivered(eventId, securityNoticeHandlerKey(recipientId)),
    },
  });
  const registry = new OutboxHandlerRegistry();
  registry.register(SECURITY_NOTICE_EVENT_TYPE, async (event) => {
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
    [eventId, 'identity.security-notice:%'],
  );
  return result.rowCount ?? 0;
}

async function makeEventDueNow(eventId: string): Promise<void> {
  await db.admin.query('update outbox_events set next_attempt_at = now() where id = $1', [eventId]);
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  orgA = await seedOrganization('security-notice-a');
  orgB = await seedOrganization('security-notice-b');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  mailer = new InMemoryMailer();
  await db.admin.query('delete from outbox_events');
  await db.admin.query('delete from outbox_deliveries');
});

// SENSIBLE (revisión humana): aislamiento por organización y atomicidad del aviso con la acción de seguridad.
describe('security notice (ADR 0035) against PostgreSQL', () => {
  it('writes the event in the same transaction and carries only the id, the kind and the moment', async () => {
    await enqueueNotice(orgA);

    const eventId = await eventIdOf(orgA);
    const row = await db.admin.query<{ payload: Record<string, unknown> }>(
      'select payload from outbox_events where id = $1',
      [eventId],
    );
    const payload = row.rows[0]?.payload ?? {};

    expect(Object.keys(payload).sort()).toEqual(['kind', 'occurredAt', 'userId']);
    expect(JSON.stringify(payload)).not.toContain('@');
  });

  it('leaves no event when the transaction rolls back', async () => {
    await expect(enqueueNotice(orgA, { failAfterEnqueue: true })).rejects.toThrow(
      'action failed after enqueue',
    );

    const count = await db.admin.query(
      'select 1 from outbox_events where organization_id = $1 and type = $2',
      [orgA.organizationId, SECURITY_NOTICE_EVENT_TYPE],
    );
    expect(count.rowCount).toBe(0);
  });

  it('emails only the account owner of the event, in their language', async () => {
    await enqueueNotice(orgA);
    const eventId = await eventIdOf(orgA);

    const summary = await buildWorker(buildRegistry()).runOnce();

    expect(summary).toMatchObject({ published: 1, retryScheduled: 0, deadLettered: 0 });
    expect(mailer.notices).toHaveLength(1);
    expect(mailer.notices[0]).toMatchObject({
      to: orgA.userEmail,
      locale: 'es-MX',
      kind: 'totp_removed',
    });
    expect(mailer.notices.some((sent) => sent.to === orgB.userEmail)).toBe(false);
    expect(await receiptCount(eventId)).toBe(1);
  });

  it('keeps the receipt when the worker rolls back after sending, so the retry does not resend', async () => {
    await enqueueNotice(orgA);
    const eventId = await eventIdOf(orgA);

    const first = await buildWorker(buildRegistry({ failAfterHandling: true })).runOnce();

    expect(first).toMatchObject({ published: 0, retryScheduled: 1 });
    expect(mailer.notices).toHaveLength(1);
    expect(await receiptCount(eventId)).toBe(1);

    await makeEventDueNow(eventId);
    const second = await buildWorker(buildRegistry()).runOnce();

    expect(second.published).toBe(1);
    expect(mailer.notices).toHaveLength(1);
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
    expect(mailer.notices).toHaveLength(1);
  });

  it('keeps the receipts of each organization isolated', async () => {
    await enqueueNotice(orgA);
    const eventA = await eventIdOf(orgA);
    await enqueueNotice(orgB);
    const eventB = await eventIdOf(orgB);

    await buildWorker(buildRegistry()).runOnce();

    expect(mailer.notices.map((sent) => sent.to).sort()).toEqual(
      [orgA.userEmail, orgB.userEmail].sort(),
    );
    const visibleFromA = await requestContext.run(contextFor(orgA.organizationId), () =>
      uow.run(async () => {
        const receipts = new PgOutboxDeliveryReceipts(uow, uow);
        return {
          own: await receipts.wasDelivered(eventA, securityNoticeHandlerKey(orgA.userId)),
          foreign: await receipts.wasDelivered(eventB, securityNoticeHandlerKey(orgB.userId)),
        };
      }),
    );
    expect(visibleFromA).toEqual({ own: true, foreign: false });
  });
});
