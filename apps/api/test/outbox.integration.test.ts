import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { PgOrganizationLister } from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_MAX_ATTEMPTS,
  OutboxHandlerRegistry,
  OutboxWorker,
  PgOutboxRepository,
} from '../src/modules/outbox/index.js';
import type { OutboxEvent } from '../src/modules/outbox/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const TEST_TYPE = 'test.event';
const SLOW_HANDLER_MS = 25;
const CONCURRENT_EVENT_COUNT = 24;
/** Margen para comparar `next_attempt_at` contra el reloj real sin falsos fallos por milisegundos. */
const CLOCK_TOLERANCE_MS = 5000;

let db: TestDatabase;
let orgA: string;
let orgB: string;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;

function buildWorker(handlers: OutboxHandlerRegistry): OutboxWorker {
  return new OutboxWorker({
    organizations: new PgOrganizationLister(db.appPool),
    repository: new PgOutboxRepository(uow),
    scope: new PgTenantScope(requestContext, uow),
    handlers,
    ids: new UuidV7Generator(),
    clock: new SystemClock(),
    // El contenido nunca se registra; aquí se descarta todo el log.
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
}

async function seedEvent(
  organizationId: string,
  type: string = TEST_TYPE,
  attempts = 0,
): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `insert into outbox_events (organization_id, aggregate, type, payload, attempts)
     values ($1, 'test', $2, '{"marker":"integration"}', $3) returning id`,
    [organizationId, type, attempts],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

interface StoredRow {
  published_at: Date | null;
  attempts: number;
  next_attempt_at: Date;
  is_dead_lettered: boolean;
}

async function readRow(eventId: string): Promise<StoredRow> {
  const result = await db.admin.query<StoredRow>(
    `select published_at, attempts, next_attempt_at,
            (published_at is null and next_attempt_at = 'infinity') as is_dead_lettered
       from outbox_events where id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('event not found');
  return row;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('outbox-a');
  orgB = await db.seedOrganization('outbox-b');
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Cada prueba parte de una cola vacía: el trabajador recorre todas las organizaciones.
  await db.admin.query('delete from outbox_events');
});

describe('OutboxWorker against PostgreSQL', () => {
  it('publishes the pending events of every organization', async () => {
    const eventA = await seedEvent(orgA);
    const eventB = await seedEvent(orgB);
    const handled: string[] = [];
    const handlers = new OutboxHandlerRegistry();
    handlers.register(TEST_TYPE, (event) => {
      handled.push(event.id);
      return Promise.resolve();
    });

    const summary = await buildWorker(handlers).runOnce();

    expect(summary).toMatchObject({ published: 2, failedOrganizations: 0 });
    expect(handled.sort()).toEqual([eventA, eventB].sort());
    expect((await readRow(eventA)).published_at).not.toBeNull();
    expect((await readRow(eventB)).published_at).not.toBeNull();
  });

  it('runs each handler with the organization of its own event and never exposes other tenants', async () => {
    const idsA = [await seedEvent(orgA), await seedEvent(orgA)];
    const idsB = [await seedEvent(orgB), await seedEvent(orgB)];
    const observations: {
      event: OutboxEvent;
      settingOrg: string | undefined;
      visibleOrgs: string[];
    }[] = [];
    const handlers = new OutboxHandlerRegistry();
    handlers.register(TEST_TYPE, async (event) => {
      const client = uow.current();
      const setting = await client.query<{ org: string }>(
        "select current_setting('app.org_id') as org",
      );
      // Lo que el manejador puede leer: debe ser solo la cola de su propia organización.
      const visible = await client.query<{ organization_id: string }>(
        'select distinct organization_id from outbox_events',
      );
      observations.push({
        event,
        settingOrg: setting.rows[0]?.org,
        visibleOrgs: visible.rows.map((row) => row.organization_id),
      });
    });

    await buildWorker(handlers).runOnce();

    expect(observations).toHaveLength(4);
    for (const observation of observations) {
      expect(observation.settingOrg).toBe(observation.event.organizationId);
      expect(observation.visibleOrgs).toEqual([observation.event.organizationId]);
    }
    expect(
      observations
        .filter((o) => o.event.organizationId === orgA)
        .map((o) => o.event.id)
        .sort(),
    ).toEqual(idsA.sort());
    expect(
      observations
        .filter((o) => o.event.organizationId === orgB)
        .map((o) => o.event.id)
        .sort(),
    ).toEqual(idsB.sort());
  });

  it('never delivers the same event twice to two concurrent claimers (SKIP LOCKED)', async () => {
    const seeded: string[] = [];
    for (let index = 0; index < CONCURRENT_EVENT_COUNT; index += 1) {
      seeded.push(await seedEvent(orgA));
    }
    const deliveries: string[] = [];
    const buildSlowHandlers = (): OutboxHandlerRegistry => {
      const handlers = new OutboxHandlerRegistry();
      handlers.register(TEST_TYPE, async (event) => {
        // La pausa mantiene el bloqueo de fila el tiempo suficiente para que el otro reclamante choque con él.
        await sleep(SLOW_HANDLER_MS);
        deliveries.push(event.id);
      });
      return handlers;
    };

    const [first, second] = await Promise.all([
      buildWorker(buildSlowHandlers()).runOnce(),
      buildWorker(buildSlowHandlers()).runOnce(),
    ]);

    expect(new Set(deliveries).size).toBe(deliveries.length);
    expect(deliveries.sort()).toEqual(seeded.sort());
    expect(first.published + second.published).toBe(CONCURRENT_EVENT_COUNT);
    // Los dos reclamantes trabajaron: si uno esperara al otro, el primero habría publicado todo.
    expect(first.published).toBeGreaterThan(0);
    expect(second.published).toBeGreaterThan(0);
  });

  it('rolls back what a failing handler wrote, counts the attempt and backs off', async () => {
    const eventId = await seedEvent(orgA);
    const handlers = new OutboxHandlerRegistry();
    handlers.register(TEST_TYPE, async () => {
      await uow
        .current()
        .query(
          "insert into outbox_events (organization_id, aggregate, type, payload) values (nullif(current_setting('app.org_id', true), '')::uuid, 'side-effect', 'test.side-effect', '{}')",
        );
      throw new Error('handler failure');
    });
    const startedAt = Date.now();

    const summary = await buildWorker(handlers).runOnce();

    expect(summary).toMatchObject({ published: 0, retryScheduled: 1 });
    const row = await readRow(eventId);
    expect(row.published_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at.getTime()).toBeGreaterThanOrEqual(
      startedAt + OUTBOX_BACKOFF_BASE_MS - CLOCK_TOLERANCE_MS,
    );
    const sideEffects = await db.admin.query(
      "select 1 from outbox_events where aggregate = 'side-effect'",
    );
    expect(sideEffects.rowCount).toBe(0);
  });

  it('dead-letters after the maximum attempts and never claims the event again', async () => {
    const eventId = await seedEvent(orgA, TEST_TYPE, OUTBOX_MAX_ATTEMPTS - 1);
    let calls = 0;
    const handlers = new OutboxHandlerRegistry();
    handlers.register(TEST_TYPE, () => {
      calls += 1;
      return Promise.reject(new Error('still failing'));
    });
    const worker = buildWorker(handlers);

    const first = await worker.runOnce();
    const second = await worker.runOnce();

    expect(first.deadLettered).toBe(1);
    expect(second).toMatchObject({ published: 0, retryScheduled: 0, deadLettered: 0 });
    expect(calls).toBe(1);
    const row = await readRow(eventId);
    expect(row.is_dead_lettered).toBe(true);
    expect(row.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
  });

  it('dead-letters at once an error marked as non-retryable, on the first attempt', async () => {
    const eventId = await seedEvent(orgA);
    let calls = 0;
    const handlers = new OutboxHandlerRegistry();
    handlers.register(TEST_TYPE, () => {
      calls += 1;
      return Promise.reject(Object.assign(new Error('invalid payload'), { retryable: false }));
    });
    const worker = buildWorker(handlers);

    const first = await worker.runOnce();
    const second = await worker.runOnce();

    expect(first).toMatchObject({ deadLettered: 1, retryScheduled: 0 });
    expect(second).toMatchObject({ published: 0, retryScheduled: 0, deadLettered: 0 });
    expect(calls).toBe(1);
    const row = await readRow(eventId);
    expect(row.is_dead_lettered).toBe(true);
    expect(row.attempts).toBe(1);
  });

  it('leaves an unknown type pending, without counting an attempt, rescheduled at the backoff cap', async () => {
    // Más intentos que el máximo: si el tipo desconocido contara intentos, iría a cuarentena.
    const unknownId = await seedEvent(orgA, 'nobody.handles.this', OUTBOX_MAX_ATTEMPTS + 2);
    const knownId = await seedEvent(orgA);
    const handlers = new OutboxHandlerRegistry();
    handlers.register(TEST_TYPE, () => Promise.resolve());
    const startedAt = Date.now();

    const summary = await buildWorker(handlers).runOnce();

    expect(summary).toMatchObject({
      published: 1,
      retryScheduled: 0,
      deadLettered: 0,
      deferredUnknownType: 1,
      failedOrganizations: 0,
    });
    const unknownRow = await readRow(unknownId);
    expect(unknownRow.published_at).toBeNull();
    expect(unknownRow.attempts).toBe(OUTBOX_MAX_ATTEMPTS + 2);
    expect(unknownRow.is_dead_lettered).toBe(false);
    expect(unknownRow.next_attempt_at.getTime()).toBeGreaterThanOrEqual(
      startedAt + OUTBOX_BACKOFF_CAP_MS - CLOCK_TOLERANCE_MS,
    );
    expect((await readRow(knownId)).published_at).not.toBeNull();
  });

  it('leaves no event behind when the business transaction rolls back, and publishes it when it commits', async () => {
    const insertEvent = async (aggregate: string): Promise<void> => {
      await uow.current().query(
        `insert into outbox_events (organization_id, aggregate, type, payload)
           values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, '{}')`,
        [aggregate, TEST_TYPE],
      );
    };

    await expect(
      requestContext.run(contextFor(orgA), () =>
        uow.run(async () => {
          await insertEvent('rolled-back');
          throw new Error('business failure');
        }),
      ),
    ).rejects.toThrow('business failure');
    await requestContext.run(contextFor(orgA), () => uow.run(() => insertEvent('committed')));
    const handled: string[] = [];
    const handlers = new OutboxHandlerRegistry();
    handlers.register(TEST_TYPE, (event) => {
      handled.push(event.aggregate);
      return Promise.resolve();
    });

    await buildWorker(handlers).runOnce();

    // El evento de la transacción revertida nunca existió, así que nadie lo publica.
    expect(handled).toEqual(['committed']);
  });
});
