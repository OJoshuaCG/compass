import { afterEach, describe, expect, it, vi } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import { OUTBOX_FAILURE_CODES } from '../domain/outbox-event.js';
import type { OutboxEvent } from '../domain/outbox-event.js';
import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_HANDLER_TIMEOUT_MS,
  OUTBOX_MAX_ATTEMPTS,
  computeBackoffMs,
  isNonRetryableError,
} from '../domain/retry-policy.js';
import { OutboxHandlerRegistry } from './handler-registry.js';
import { OutboxWorker } from './outbox-worker.js';
import type { OutboxLogger } from './ports/outbox-ports.js';
import type { OutboxRepository } from './ports/outbox-repository.js';

const ORG = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const NOW = new Date('2026-01-01T12:00:00.000Z');
const SECRET_MARKER = 'super-secret-payload-marker';
const ERROR_MESSAGE_MARKER = 'secret-error-message-marker';

interface StoredEvent {
  event: OutboxEvent;
  publishedAt: Date | null;
  /** `null` = en cuarentena (dead letter). */
  nextAttemptAt: Date | null;
}

/** Repositorio en memoria con la misma semántica de reclamo que el real (pendiente y vencido). */
class InMemoryOutboxRepository implements OutboxRepository {
  readonly stored: StoredEvent[] = [];

  add(partial: Partial<OutboxEvent> & Pick<OutboxEvent, 'id' | 'type'>): StoredEvent {
    const entry: StoredEvent = {
      event: {
        organizationId: ORG,
        aggregate: 'test',
        payload: { secret: SECRET_MARKER },
        attempts: 0,
        ...partial,
      },
      publishedAt: null,
      nextAttemptAt: NOW,
    };
    this.stored.push(entry);
    return entry;
  }

  claimNext(now: Date): Promise<OutboxEvent | null> {
    const entry = this.stored.find(
      (candidate) =>
        candidate.publishedAt === null &&
        candidate.nextAttemptAt !== null &&
        candidate.nextAttemptAt <= now,
    );
    return Promise.resolve(entry?.event ?? null);
  }

  markPublished(eventId: string, publishedAt: Date): Promise<void> {
    this.require(eventId).publishedAt = publishedAt;
    return Promise.resolve();
  }

  scheduleRetry(eventId: string, failedAttempts: number, nextAttemptAt: Date): Promise<void> {
    const entry = this.require(eventId);
    entry.event = { ...entry.event, attempts: failedAttempts };
    entry.nextAttemptAt = nextAttemptAt;
    return Promise.resolve();
  }

  deferWithoutAttempt(eventId: string, nextAttemptAt: Date): Promise<void> {
    // Igual que el real: `attempts` no cambia.
    this.require(eventId).nextAttemptAt = nextAttemptAt;
    return Promise.resolve();
  }

  markDeadLettered(eventId: string, failedAttempts: number): Promise<void> {
    const entry = this.require(eventId);
    entry.event = { ...entry.event, attempts: failedAttempts };
    entry.nextAttemptAt = null;
    return Promise.resolve();
  }

  private require(eventId: string): StoredEvent {
    const entry = this.stored.find((candidate) => candidate.event.id === eventId);
    if (entry === undefined) throw new Error('missing event');
    return entry;
  }
}

class RecordingLogger implements OutboxLogger {
  readonly entries: { level: string; fields: Record<string, unknown>; message: string }[] = [];

  info(fields: Record<string, unknown>, message: string): void {
    this.entries.push({ level: 'info', fields, message });
  }

  warn(fields: Record<string, unknown>, message: string): void {
    this.entries.push({ level: 'warn', fields, message });
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.entries.push({ level: 'error', fields, message });
  }
}

const passthroughScope: TenantScope = {
  runAs: (_context, fn) => fn(),
  runAsAtomic: (_context, fn) => fn(),
};

function buildWorker(options: {
  repository: InMemoryOutboxRepository;
  handlers: OutboxHandlerRegistry;
  logger?: RecordingLogger;
  organizations?: readonly OrganizationId[];
  scope?: TenantScope;
}): OutboxWorker {
  return new OutboxWorker({
    organizations: { listIds: () => Promise.resolve(options.organizations ?? [ORG]) },
    repository: options.repository,
    scope: options.scope ?? passthroughScope,
    handlers: options.handlers,
    ids: { next: () => 'req-1' },
    clock: { now: () => NOW },
    logger: options.logger ?? new RecordingLogger(),
  });
}

describe('OutboxWorker', () => {
  it('publishes an event through the handler registered for its type', async () => {
    const repository = new InMemoryOutboxRepository();
    const entry = repository.add({ id: 'evt-1', type: 'test.ok' });
    const handled: string[] = [];
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.ok', (event) => {
      handled.push(event.id);
      return Promise.resolve();
    });

    const summary = await buildWorker({ repository, handlers }).runOnce();

    expect(handled).toEqual(['evt-1']);
    expect(entry.publishedAt).toEqual(NOW);
    expect(summary).toMatchObject({ published: 1, retryScheduled: 0, deadLettered: 0 });
  });

  it('schedules a retry with exponential backoff when the handler fails', async () => {
    const repository = new InMemoryOutboxRepository();
    const entry = repository.add({ id: 'evt-1', type: 'test.fail' });
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.fail', () => Promise.reject(new Error('boom')));
    const worker = buildWorker({ repository, handlers });

    const summary = await worker.runOnce();

    expect(summary.retryScheduled).toBe(1);
    expect(entry.publishedAt).toBeNull();
    expect(entry.event.attempts).toBe(1);
    expect(entry.nextAttemptAt?.getTime()).toBe(NOW.getTime() + OUTBOX_BACKOFF_BASE_MS);
    // Aún no vence: la siguiente pasada no lo vuelve a tomar.
    expect((await worker.runOnce()).retryScheduled).toBe(0);
  });

  it('doubles the wait on each failure and caps it', () => {
    expect(computeBackoffMs(1)).toBe(OUTBOX_BACKOFF_BASE_MS);
    expect(computeBackoffMs(2)).toBe(OUTBOX_BACKOFF_BASE_MS * 2);
    expect(computeBackoffMs(3)).toBe(OUTBOX_BACKOFF_BASE_MS * 4);
    expect(computeBackoffMs(40)).toBe(OUTBOX_BACKOFF_CAP_MS);
  });

  it('leaves an event with an unknown type pending without counting an attempt', async () => {
    const repository = new InMemoryOutboxRepository();
    const unknown = repository.add({ id: 'evt-unknown', type: 'nobody.handles.this' });
    const known = repository.add({ id: 'evt-known', type: 'test.ok' });
    const logger = new RecordingLogger();
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.ok', () => Promise.resolve());

    const summary = await buildWorker({ repository, handlers, logger }).runOnce();

    expect(summary).toMatchObject({
      published: 1,
      retryScheduled: 0,
      deadLettered: 0,
      deferredUnknownType: 1,
      failedOrganizations: 0,
    });
    expect(unknown.publishedAt).toBeNull();
    expect(unknown.event.attempts).toBe(0);
    expect(unknown.nextAttemptAt?.getTime()).toBe(NOW.getTime() + OUTBOX_BACKOFF_CAP_MS);
    expect(known.publishedAt).toEqual(NOW);
    const notice = logger.entries.find((entry) => entry.fields.type === 'nobody.handles.this');
    expect(notice?.fields).toMatchObject({
      errorCode: OUTBOX_FAILURE_CODES.unknownType,
      outcome: 'deferred_unknown_type',
      count: 1,
    });
  });

  it('never dead-letters an unknown type, even beyond the maximum number of attempts', async () => {
    const repository = new InMemoryOutboxRepository();
    const unknown = repository.add({
      id: 'evt-unknown',
      type: 'nobody.handles.this',
      attempts: OUTBOX_MAX_ATTEMPTS + 5,
    });
    const worker = buildWorker({ repository, handlers: new OutboxHandlerRegistry() });

    const first = await worker.runOnce();
    const second = await worker.runOnce();

    expect(first).toMatchObject({ deferredUnknownType: 1, deadLettered: 0, retryScheduled: 0 });
    // Ya está reprogramada al tope: la segunda pasada ni siquiera la toma.
    expect(second).toMatchObject({ deferredUnknownType: 0, deadLettered: 0 });
    expect(unknown.event.attempts).toBe(OUTBOX_MAX_ATTEMPTS + 5);
    expect(unknown.nextAttemptAt).not.toBeNull();
    expect(unknown.nextAttemptAt?.getTime()).toBe(NOW.getTime() + OUTBOX_BACKOFF_CAP_MS);
  });

  it('logs an unknown type once per pass with only its name and count', async () => {
    const repository = new InMemoryOutboxRepository();
    repository.add({ id: 'evt-1', type: 'nobody.handles.this' });
    repository.add({ id: 'evt-2', type: 'nobody.handles.this' });
    const logger = new RecordingLogger();

    await buildWorker({ repository, handlers: new OutboxHandlerRegistry(), logger }).runOnce();

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.fields).toEqual({
      type: 'nobody.handles.this',
      count: 2,
      outcome: 'deferred_unknown_type',
      errorCode: OUTBOX_FAILURE_CODES.unknownType,
    });
  });

  it('dead-letters the event once the maximum number of attempts is reached', async () => {
    const repository = new InMemoryOutboxRepository();
    const entry = repository.add({
      id: 'evt-1',
      type: 'test.fail',
      attempts: OUTBOX_MAX_ATTEMPTS - 1,
    });
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.fail', () => Promise.reject(new Error('boom')));

    const summary = await buildWorker({ repository, handlers }).runOnce();

    expect(summary.deadLettered).toBe(1);
    expect(entry.publishedAt).toBeNull();
    expect(entry.nextAttemptAt).toBeNull();
    expect(entry.event.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
  });

  it('dead-letters at once an error marked as non-retryable, without spending the retries', async () => {
    const repository = new InMemoryOutboxRepository();
    const entry = repository.add({ id: 'evt-1', type: 'test.invalid-payload' });
    const retryableEntry = repository.add({ id: 'evt-2', type: 'test.fail' });
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.invalid-payload', () =>
      Promise.reject(Object.assign(new Error('invalid payload'), { retryable: false })),
    );
    handlers.register('test.fail', () => Promise.reject(new Error('boom')));

    const summary = await buildWorker({ repository, handlers }).runOnce();

    expect(summary).toMatchObject({ deadLettered: 1, retryScheduled: 1 });
    expect(entry.publishedAt).toBeNull();
    expect(entry.nextAttemptAt).toBeNull();
    expect(entry.event.attempts).toBe(1);
    // Un fallo común sigue el camino normal: reintento con espera.
    expect(retryableEntry.nextAttemptAt?.getTime()).toBe(NOW.getTime() + OUTBOX_BACKOFF_BASE_MS);
  });

  describe('isNonRetryableError', () => {
    it('only recognizes errors that declare retryable = false', () => {
      expect(isNonRetryableError(Object.assign(new Error('x'), { retryable: false }))).toBe(true);
      expect(isNonRetryableError(new Error('x'))).toBe(false);
      expect(isNonRetryableError(Object.assign(new Error('x'), { retryable: true }))).toBe(false);
      expect(isNonRetryableError({ retryable: false })).toBe(false);
      expect(isNonRetryableError('x')).toBe(false);
    });
  });

  describe('logging', () => {
    it('never writes the payload or the error message of a handler to any log call', async () => {
      const repository = new InMemoryOutboxRepository();
      repository.add({ id: 'evt-ok', type: 'test.ok' });
      repository.add({ id: 'evt-fail', type: 'test.fail' });
      repository.add({ id: 'evt-unknown', type: 'test.unknown' });
      const logger = {
        info: vi.fn<OutboxLogger['info']>(),
        warn: vi.fn<OutboxLogger['warn']>(),
        error: vi.fn<OutboxLogger['error']>(),
      };
      const handlers = new OutboxHandlerRegistry();
      handlers.register('test.ok', () => Promise.resolve());
      handlers.register('test.fail', () =>
        Promise.reject(new Error(`leaks ${ERROR_MESSAGE_MARKER}`)),
      );
      const worker = new OutboxWorker({
        organizations: { listIds: () => Promise.resolve([ORG]) },
        repository,
        scope: passthroughScope,
        handlers,
        ids: { next: () => 'req-1' },
        clock: { now: () => NOW },
        logger,
      });

      await worker.runOnce();

      const allCalls = [
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ];
      // Debe haber registrado algo: si no, la prueba no demostraría nada.
      expect(allCalls.length).toBeGreaterThanOrEqual(3);
      const serializedCalls = JSON.stringify(allCalls);
      expect(serializedCalls).not.toContain(ERROR_MESSAGE_MARKER);
      expect(serializedCalls).not.toContain(SECRET_MARKER);
    });
  });

  it('runs each event in a transaction scoped to the organization of the event', async () => {
    const repository = new InMemoryOutboxRepository();
    repository.add({ id: 'evt-1', type: 'test.ok' });
    const scopedOrganizations: string[] = [];
    const scope: TenantScope = {
      runAs: (context, fn) => {
        scopedOrganizations.push(context.organizationId);
        return fn();
      },
      runAsAtomic: (_context, fn) => fn(),
    };
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.ok', () => Promise.resolve());

    await buildWorker({ repository, handlers, scope }).runOnce();

    // Un reclamo con evento y otro sin evento (fin de la cola), ambos con la organización.
    expect(scopedOrganizations).toEqual([ORG, ORG]);
  });

  it('keeps processing other organizations when one fails at infrastructure level', async () => {
    const brokenOrganization = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
    const repository = new InMemoryOutboxRepository();
    const entry = repository.add({ id: 'evt-1', type: 'test.ok' });
    const scope: TenantScope = {
      runAs: (context, fn) =>
        context.organizationId === brokenOrganization ? Promise.reject(new Error('db down')) : fn(),
      runAsAtomic: (_context, fn) => fn(),
    };
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.ok', () => Promise.resolve());

    const summary = await buildWorker({
      repository,
      handlers,
      scope,
      organizations: [brokenOrganization, ORG],
    }).runOnce();

    expect(summary).toMatchObject({ published: 1, failedOrganizations: 1 });
    expect(entry.publishedAt).toEqual(NOW);
  });

  it('rejects registering two handlers for the same type', () => {
    const handlers = new OutboxHandlerRegistry();
    handlers.register('test.ok', () => Promise.resolve());

    expect(() => {
      handlers.register('test.ok', () => Promise.resolve());
    }).toThrow();
  });

  describe('handler timeout', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('treats a handler that never settles as a failure and counts the attempt', async () => {
      vi.useFakeTimers();
      const repository = new InMemoryOutboxRepository();
      const entry = repository.add({ id: 'evt-hung', type: 'test.hung' });
      const logger = new RecordingLogger();
      const handlers = new OutboxHandlerRegistry();
      handlers.register('test.hung', () => new Promise<void>(() => undefined));

      const pass = buildWorker({ repository, handlers, logger }).runOnce();
      await vi.advanceTimersByTimeAsync(OUTBOX_HANDLER_TIMEOUT_MS);
      const summary = await pass;

      expect(summary).toMatchObject({ published: 0, retryScheduled: 1 });
      expect(entry.publishedAt).toBeNull();
      expect(entry.event.attempts).toBe(1);
      expect(entry.nextAttemptAt?.getTime()).toBe(NOW.getTime() + OUTBOX_BACKOFF_BASE_MS);
      const failure = logger.entries.find((logged) => logged.fields.eventId === 'evt-hung');
      expect(failure?.fields).toMatchObject({ errorCode: OUTBOX_FAILURE_CODES.handlerTimeout });
    });

    it('does not time out a handler that finishes within the limit', async () => {
      vi.useFakeTimers();
      const repository = new InMemoryOutboxRepository();
      const entry = repository.add({ id: 'evt-slow', type: 'test.slow' });
      const handlers = new OutboxHandlerRegistry();
      handlers.register(
        'test.slow',
        () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      );

      const pass = buildWorker({ repository, handlers }).runOnce();
      await vi.advanceTimersByTimeAsync(1000);
      const summary = await pass;

      expect(summary).toMatchObject({ published: 1, retryScheduled: 0 });
      expect(entry.publishedAt).toEqual(NOW);
    });
  });

  describe('cooperative stop', () => {
    it('stops taking events once isStopping turns true, between events', async () => {
      const repository = new InMemoryOutboxRepository();
      const first = repository.add({ id: 'evt-1', type: 'test.ok' });
      const second = repository.add({ id: 'evt-2', type: 'test.ok' });
      let stopping = false;
      const handlers = new OutboxHandlerRegistry();
      handlers.register('test.ok', () => {
        stopping = true;
        return Promise.resolve();
      });

      const summary = await buildWorker({ repository, handlers }).runOnce({
        isStopping: () => stopping,
      });

      expect(summary.published).toBe(1);
      expect(first.publishedAt).toEqual(NOW);
      expect(second.publishedAt).toBeNull();
    });

    it('does not start the next organization once isStopping turns true', async () => {
      const otherOrganization = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
      const repository = new InMemoryOutboxRepository();
      repository.add({ id: 'evt-1', type: 'test.ok' });
      const scopedOrganizations: string[] = [];
      const scope: TenantScope = {
        runAs: (context, fn) => {
          scopedOrganizations.push(context.organizationId);
          return fn();
        },
        runAsAtomic: (_context, fn) => fn(),
      };
      let stopping = false;
      const handlers = new OutboxHandlerRegistry();
      handlers.register('test.ok', () => {
        stopping = true;
        return Promise.resolve();
      });

      await buildWorker({
        repository,
        handlers,
        scope,
        organizations: [ORG, otherOrganization],
      }).runOnce({ isStopping: () => stopping });

      expect(scopedOrganizations).not.toContain(otherOrganization);
    });
  });

  describe('organization assertion', () => {
    it('does not process an event whose organization differs from the scope and counts the organization as failed', async () => {
      const scopedOrganization = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
      const repository = new InMemoryOutboxRepository();
      // El repositorio en memoria devuelve el evento de ORG aunque el ámbito sea otro: simula un RLS roto.
      const foreign = repository.add({ id: 'evt-foreign', type: 'test.ok' });
      const logger = new RecordingLogger();
      let handlerCalls = 0;
      const handlers = new OutboxHandlerRegistry();
      handlers.register('test.ok', () => {
        handlerCalls += 1;
        return Promise.resolve();
      });

      const summary = await buildWorker({
        repository,
        handlers,
        logger,
        organizations: [scopedOrganization],
      }).runOnce();

      expect(handlerCalls).toBe(0);
      expect(foreign.publishedAt).toBeNull();
      expect(foreign.event.attempts).toBe(0);
      expect(summary).toMatchObject({ published: 0, failedOrganizations: 1 });
      const mismatch = logger.entries.find(
        (entry) => entry.fields.outcome === 'organization_mismatch',
      );
      expect(mismatch?.fields).toEqual({
        eventId: 'evt-foreign',
        eventOrganizationId: ORG,
        scopeOrganizationId: scopedOrganization,
        outcome: 'organization_mismatch',
      });
      expect(JSON.stringify(logger.entries)).not.toContain(SECRET_MARKER);
    });
  });
});
