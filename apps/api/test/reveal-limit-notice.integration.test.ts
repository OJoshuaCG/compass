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
  NotifyRevealLimitExceeded,
  PgVaultCredentialRepository,
  REVEAL_LIMIT_NOTICE_EVENT_TYPE,
  REVEAL_LIMIT_NOTICE_HANDLER_KEY,
  revealLimitNoticeHandlerKey,
} from '../src/modules/vault/index.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const LIMIT_PER_HOUR = 30;
const WINDOW_SECONDS = 3600;
const SECRET_MARKER = 'super-secret-credential-label';

interface SeededOrganization {
  readonly organizationId: string;
  readonly rootId: string;
  readonly rootEmail: string;
  readonly operatorId: string;
}

let db: TestDatabase;
let orgA: SeededOrganization;
let orgB: SeededOrganization;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let mailer: InMemoryMailer;

async function seedOrganization(slug: string): Promise<SeededOrganization> {
  const organizationId = await db.seedOrganization(slug);
  const rootEmail = `root@${slug}.test`;
  const root = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, locale) values ($1, $2, 'Root', 0, 'active', 'en-US') returning id",
    [organizationId, rootEmail],
  );
  const rootId = root.rows[0]?.id;
  if (rootId === undefined) throw new Error('seed failed');
  const operator = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, managed_by) values ($1, $2, 'Sofia Operator', 3, 'active', $3) returning id",
    [organizationId, `operator@${slug}.test`, rootId],
  );
  const operatorId = operator.rows[0]?.id;
  if (operatorId === undefined) throw new Error('seed failed');
  return { organizationId, rootId, rootEmail, operatorId };
}

/** Escribe el aviso con el mismo repositorio que usa el caso de uso de revelado, en su transacción. */
async function enqueueNotice(organization: SeededOrganization): Promise<string> {
  await requestContext.run(contextFor(organization.organizationId), () =>
    uow.run(() =>
      new PgVaultCredentialRepository(uow).enqueueRevealLimitNotice({
        actorId: asUserId(organization.operatorId),
        limitPerHour: LIMIT_PER_HOUR,
        revealedInWindow: LIMIT_PER_HOUR,
        windowSeconds: WINDOW_SECONDS,
        raisedAt: new Date(),
      }),
    ),
  );
  const result = await db.admin.query<{ id: string }>(
    'select id from outbox_events where organization_id = $1 and type = $2 order by id desc limit 1',
    [organization.organizationId, REVEAL_LIMIT_NOTICE_EVENT_TYPE],
  );
  const eventId = result.rows[0]?.id;
  if (eventId === undefined) throw new Error('the notice was not enqueued');
  return eventId;
}

function buildRegistry(options: { failAfterHandling?: boolean } = {}): OutboxHandlerRegistry {
  const receipts = new PgOutboxDeliveryReceipts(uow, uow);
  const handler = new NotifyRevealLimitExceeded({
    directory: new PgUserDirectory(uow),
    mailer,
    clock: new SystemClock(),
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        receipts.wasDelivered(eventId, revealLimitNoticeHandlerKey(recipientId)),
      markDelivered: (eventId, recipientId) =>
        receipts.markDelivered(eventId, revealLimitNoticeHandlerKey(recipientId)),
    },
  });
  const registry = new OutboxHandlerRegistry();
  registry.register(REVEAL_LIMIT_NOTICE_EVENT_TYPE, async (event) => {
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

/** Cuenta los acuses del evento, uno por Raíz destinataria (cada organización de la prueba tiene una). */
async function receiptCount(eventId: string): Promise<number> {
  const result = await db.admin.query(
    'select 1 from outbox_deliveries where event_id = $1 and handler_key like $2',
    [eventId, `${REVEAL_LIMIT_NOTICE_HANDLER_KEY}:%`],
  );
  return result.rowCount ?? 0;
}

async function readEvent(eventId: string) {
  const result = await db.admin.query<{
    published_at: Date | null;
    attempts: number;
    payload: Record<string, unknown>;
  }>('select published_at, attempts, payload from outbox_events where id = $1', [eventId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error('event not found');
  return row;
}

/** Salta la espera de reintento para que la siguiente pasada vuelva a reclamar el evento. */
async function makeEventDueNow(eventId: string): Promise<void> {
  await db.admin.query('update outbox_events set next_attempt_at = now() where id = $1', [eventId]);
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  orgA = await seedOrganization('reveal-a');
  orgB = await seedOrganization('reveal-b');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  mailer = new InMemoryMailer();
  await db.admin.query('delete from outbox_events');
  await db.admin.query('delete from outbox_deliveries');
  await db.admin.query("update users set status = 'active' where rank = 0");
});

describe('reveal limit notice to the Root (R2a) against PostgreSQL', () => {
  it('emails only the Root of the organization, with no secrets, and marks the event as delivered', async () => {
    const eventId = await enqueueNotice(orgA);

    const summary = await buildWorker(buildRegistry()).runOnce();

    expect(summary).toMatchObject({ published: 1, retryScheduled: 0, deadLettered: 0 });
    expect(mailer.revealLimitAlerts).toHaveLength(1);
    const alert = mailer.revealLimitAlerts[0];
    expect(alert).toMatchObject({
      to: orgA.rootEmail,
      locale: 'en-US',
      actorDisplayName: 'Sofia Operator',
      limitPerHour: LIMIT_PER_HOUR,
      revealedInWindow: LIMIT_PER_HOUR,
      windowMinutes: 60,
    });
    // Nadie de la otra organización recibe nada.
    expect(mailer.revealLimitAlerts.some((sent) => sent.to === orgB.rootEmail)).toBe(false);
    expect((await readEvent(eventId)).published_at).not.toBeNull();
    expect(await receiptCount(eventId)).toBe(1);
  });

  it('writes only ids and numbers in the payload', async () => {
    const eventId = await enqueueNotice(orgA);

    const { payload } = await readEvent(eventId);

    expect(Object.keys(payload).sort()).toEqual([
      'actorId',
      'limitPerHour',
      'raisedAt',
      'revealedInWindow',
      'windowSeconds',
    ]);
    expect(JSON.stringify(payload)).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(payload)).not.toContain('@');
  });

  it('does not resend when the same event is delivered again after it was notified', async () => {
    const eventId = await enqueueNotice(orgA);
    const worker = buildWorker(buildRegistry());
    await worker.runOnce();

    // Simula una segunda entrega (p. ej. se perdió la marca de publicado): el evento vuelve a estar pendiente.
    await db.admin.query('update outbox_events set published_at = null where id = $1', [eventId]);
    const second = await worker.runOnce();

    expect(second.published).toBe(1);
    expect(mailer.revealLimitAlerts).toHaveLength(1);
  });

  it('keeps the receipt when the worker transaction rolls back after sending, so the retry does not resend', async () => {
    const eventId = await enqueueNotice(orgA);

    const first = await buildWorker(buildRegistry({ failAfterHandling: true })).runOnce();

    expect(first).toMatchObject({ published: 0, retryScheduled: 1 });
    expect(mailer.revealLimitAlerts).toHaveLength(1);
    expect((await readEvent(eventId)).published_at).toBeNull();
    // El acuse se confirmó en una transacción independiente: sobrevive al rollback del trabajador.
    expect(await receiptCount(eventId)).toBe(1);

    await makeEventDueNow(eventId);
    const second = await buildWorker(buildRegistry()).runOnce();

    expect(second.published).toBe(1);
    expect(mailer.revealLimitAlerts).toHaveLength(1);
  });

  it('retries without a receipt when the mail provider fails, and sends once it recovers', async () => {
    const eventId = await enqueueNotice(orgA);
    mailer.failNext = true;
    const worker = buildWorker(buildRegistry());

    const first = await worker.runOnce();

    expect(first).toMatchObject({ published: 0, retryScheduled: 1 });
    expect((await readEvent(eventId)).attempts).toBe(1);
    expect(await receiptCount(eventId)).toBe(0);
    expect(mailer.revealLimitAlerts).toHaveLength(0);

    await makeEventDueNow(eventId);
    const second = await worker.runOnce();

    expect(second.published).toBe(1);
    expect(mailer.revealLimitAlerts).toHaveLength(1);
    expect(await receiptCount(eventId)).toBe(1);
  });

  it('does not mark the event as delivered when the organization has no active Root', async () => {
    const eventId = await enqueueNotice(orgA);
    await db.admin.query(
      "update users set status = 'suspended' where organization_id = $1 and rank = 0",
      [orgA.organizationId],
    );

    const summary = await buildWorker(buildRegistry()).runOnce();

    expect(summary).toMatchObject({ published: 0, retryScheduled: 1 });
    expect(mailer.revealLimitAlerts).toHaveLength(0);
    expect(await receiptCount(eventId)).toBe(0);
  });

  it('keeps the receipts of each organization isolated', async () => {
    const eventA = await enqueueNotice(orgA);
    const eventB = await enqueueNotice(orgB);

    await buildWorker(buildRegistry()).runOnce();

    expect(mailer.revealLimitAlerts.map((sent) => sent.to).sort()).toEqual(
      [orgA.rootEmail, orgB.rootEmail].sort(),
    );
    const visibleFromA = await requestContext.run(contextFor(orgA.organizationId), () =>
      uow.run(async () => {
        const receipts = new PgOutboxDeliveryReceipts(uow, uow);
        return {
          own: await receipts.wasDelivered(eventA, revealLimitNoticeHandlerKey(orgA.rootId)),
          foreign: await receipts.wasDelivered(eventB, revealLimitNoticeHandlerKey(orgB.rootId)),
        };
      }),
    );
    expect(visibleFromA).toEqual({ own: true, foreign: false });
  });
});
