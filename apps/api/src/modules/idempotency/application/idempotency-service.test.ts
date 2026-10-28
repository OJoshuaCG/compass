import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { asOrganizationId, asUserId, DomainError } from '../../../shared/kernel/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import type { CryptoPrimitives } from '../../crypto/index.js';
import type { ScopeContext, TenantScope } from '../../organization/index.js';
import { IN_FLIGHT_MS, IdempotencyService, REPLAY_WINDOW_MS } from './idempotency-service.js';
import type { IdempotencyCall } from './idempotency-service.js';
import type { IdempotencyStore, StoredResponse } from './ports/idempotency-store.js';

/**
 * Almacén en memoria que reproduce las condiciones del SQL real (`pg-idempotency-store.ts`):
 * la clave es por actor, tomar una reserva exige que esté vencida y completar o liberar exigen ser
 * la dueña de la reserva (`status_code is null` y `expires_at = reservedUntil`).
 */
class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly rows = new Map<string, StoredResponse>();
  /** Fuerza el resultado de `takeOver` para simular que otra petición llegó primero. */
  forcedTakeOverResult: boolean | undefined;
  /** Fuerza que `find` devuelva `null` aunque `reserve` haya fallado (fila liberada entre medias). */
  findReturnsNothing = false;
  completeCalls = 0;
  releaseCalls = 0;

  private identity(actorId: UserId, key: string): string {
    return `${actorId}|${key}`;
  }

  reserve(input: {
    actorId: UserId;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const id = this.identity(input.actorId, input.key);
    if (this.rows.has(id)) return Promise.resolve(false);
    this.rows.set(id, {
      requestHash: input.requestHash,
      statusCode: null,
      body: null,
      expiresAt: input.expiresAt,
    });
    return Promise.resolve(true);
  }

  find(actorId: UserId, key: string): Promise<StoredResponse | null> {
    if (this.findReturnsNothing) return Promise.resolve(null);
    return Promise.resolve(this.rows.get(this.identity(actorId, key)) ?? null);
  }

  takeOver(input: {
    actorId: UserId;
    key: string;
    requestHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    if (this.forcedTakeOverResult !== undefined) return Promise.resolve(this.forcedTakeOverResult);
    const id = this.identity(input.actorId, input.key);
    const row = this.rows.get(id);
    if (row === undefined || row.expiresAt > input.now) return Promise.resolve(false);
    this.rows.set(id, {
      requestHash: input.requestHash,
      statusCode: null,
      body: null,
      expiresAt: input.expiresAt,
    });
    return Promise.resolve(true);
  }

  complete(input: {
    actorId: UserId;
    key: string;
    reservedUntil: Date;
    statusCode: number;
    body: unknown;
    expiresAt: Date;
  }): Promise<void> {
    this.completeCalls += 1;
    const id = this.identity(input.actorId, input.key);
    const row = this.rows.get(id);
    const ownsReservation =
      row !== undefined &&
      row.statusCode === null &&
      row.expiresAt.getTime() === input.reservedUntil.getTime();
    if (ownsReservation) {
      this.rows.set(id, {
        requestHash: row.requestHash,
        statusCode: input.statusCode,
        body: input.body,
        expiresAt: input.expiresAt,
      });
    }
    return Promise.resolve();
  }

  release(actorId: UserId, key: string, reservedUntil: Date): Promise<void> {
    this.releaseCalls += 1;
    const id = this.identity(actorId, key);
    const row = this.rows.get(id);
    const ownsReservation =
      row !== undefined &&
      row.statusCode === null &&
      row.expiresAt.getTime() === reservedUntil.getTime();
    if (ownsReservation) this.rows.delete(id);
    return Promise.resolve();
  }
}

const ORGANIZATION = asOrganizationId('org-1');
const ACTOR = asUserId('user-1');
const OTHER_ACTOR = asUserId('user-2');
const KEY = 'key-0001-abcdef';
const START = new Date('2026-01-15T10:00:00.000Z');

function setup() {
  const store = new InMemoryIdempotencyStore();
  const scopeCalls: ScopeContext[] = [];
  const scope: TenantScope = {
    runAs: (context, fn) => {
      scopeCalls.push(context);
      return fn();
    },
    runAsAtomic: (context, fn) => {
      scopeCalls.push(context);
      return fn();
    },
  };
  const primitives = {
    sha256: (data: Uint8Array) => createHash('sha256').update(data).digest(),
  } as unknown as CryptoPrimitives;
  let current = START;
  const clock = { now: () => current };
  const service = new IdempotencyService({ scope, store, primitives, clock });

  const call = (overrides: Partial<IdempotencyCall> = {}): IdempotencyCall => ({
    organizationId: ORGANIZATION,
    actorId: ACTOR,
    requestId: 'req-1',
    key: KEY,
    ...overrides,
  });
  const advance = (milliseconds: number): void => {
    current = new Date(current.getTime() + milliseconds);
  };
  return { service, store, scopeCalls, call, advance, now: () => current };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('IdempotencyService', () => {
  describe('parseKey', () => {
    it('accepts a well-formed key', () => {
      const { service } = setup();
      expect(service.parseKey('abcd1234-._:')).toBe('abcd1234-._:');
    });

    it.each([
      ['missing header', undefined],
      ['repeated header', ['abcd1234', 'abcd1234']],
      ['shorter than 8 characters', 'abc1234'],
      ['longer than 200 characters', 'a'.repeat(201)],
      ['whitespace', 'abcd 1234'],
      ['control character', 'abcd\n1234'],
      ['non-ASCII', 'clave-ñandú-1'],
    ])('rejects a key with %s', (_label, header) => {
      const { service } = setup();
      expect(() => service.parseKey(header)).toThrow(
        expect.objectContaining({ code: 'IDEMPOTENCY.KEY_REQUIRED' }) as Error,
      );
    });

    it('accepts the boundary lengths of 8 and 200 characters', () => {
      const { service } = setup();
      expect(service.parseKey('a'.repeat(8))).toHaveLength(8);
      expect(service.parseKey('a'.repeat(200))).toHaveLength(200);
    });
  });

  describe('fingerprint', () => {
    it('is stable for the same method, path and body', () => {
      const { service } = setup();
      expect(service.fingerprint('POST', '/users', { name: 'Ana' })).toBe(
        service.fingerprint('POST', '/users', { name: 'Ana' }),
      );
    });

    it('changes with the method, the path or the body', () => {
      const { service } = setup();
      const reference = service.fingerprint('POST', '/users', { name: 'Ana' });
      expect(service.fingerprint('PUT', '/users', { name: 'Ana' })).not.toBe(reference);
      expect(service.fingerprint('POST', '/roles', { name: 'Ana' })).not.toBe(reference);
      expect(service.fingerprint('POST', '/users', { name: 'Eva' })).not.toBe(reference);
    });

    it('treats a missing body like a null body', () => {
      const { service } = setup();
      expect(service.fingerprint('POST', '/users', undefined)).toBe(
        service.fingerprint('POST', '/users', null),
      );
    });

    it('does not confuse the separator between method, path and body', () => {
      const { service } = setup();
      expect(service.fingerprint('POST', '/a', 'b')).not.toBe(
        service.fingerprint('POST', '/', 'ab'),
      );
    });
  });

  describe('begin', () => {
    it('reserves a new key for one minute and runs inside the tenant scope', async () => {
      const { service, scopeCalls, call, now } = setup();

      const decision = await service.begin(call(), 'hash-a');

      expect(decision).toEqual({
        kind: 'proceed',
        reservedUntil: new Date(now().getTime() + IN_FLIGHT_MS),
      });
      expect(scopeCalls).toEqual([
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
      ]);
    });

    it('rejects the same request while the original one is still running', async () => {
      const { service, call } = setup();
      await service.begin(call(), 'hash-a');

      expect(await codeOf(service.begin(call(), 'hash-a'))).toBe('IDEMPOTENCY.IN_PROGRESS');
    });

    it('rejects a different request that reuses the key', async () => {
      const { service, call } = setup();
      await service.begin(call(), 'hash-a');

      expect(await codeOf(service.begin(call(), 'hash-b'))).toBe('IDEMPOTENCY.KEY_REUSED');
    });

    it('replays the stored response for the same request after it completed', async () => {
      const { service, call } = setup();
      const first = await service.begin(call(), 'hash-a');
      if (first.kind !== 'proceed') throw new Error('expected proceed');
      await service.complete(call(), first.reservedUntil, 201, { id: 'user-9' });

      const second = await service.begin(call(), 'hash-a');

      expect(second).toEqual({ kind: 'replay', statusCode: 201, body: { id: 'user-9' } });
    });

    it('still rejects a different request after the original completed', async () => {
      const { service, call } = setup();
      const first = await service.begin(call(), 'hash-a');
      if (first.kind !== 'proceed') throw new Error('expected proceed');
      await service.complete(call(), first.reservedUntil, 201, { id: 'user-9' });

      expect(await codeOf(service.begin(call(), 'hash-b'))).toBe('IDEMPOTENCY.KEY_REUSED');
    });

    it('keeps replaying until the 24 hour window ends and then lets the key be used again', async () => {
      const { service, call, advance } = setup();
      const first = await service.begin(call(), 'hash-a');
      if (first.kind !== 'proceed') throw new Error('expected proceed');
      await service.complete(call(), first.reservedUntil, 201, { id: 'user-9' });

      advance(REPLAY_WINDOW_MS - 1);
      expect((await service.begin(call(), 'hash-a')).kind).toBe('replay');

      advance(1);
      expect((await service.begin(call(), 'hash-b')).kind).toBe('proceed');
    });

    it('takes over a reservation whose original request never finished', async () => {
      const { service, call, advance, now } = setup();
      await service.begin(call(), 'hash-a');

      advance(IN_FLIGHT_MS);
      const decision = await service.begin(call(), 'hash-a');

      expect(decision).toEqual({
        kind: 'proceed',
        reservedUntil: new Date(now().getTime() + IN_FLIGHT_MS),
      });
    });

    it('does not take over a reservation one millisecond before it expires', async () => {
      const { service, call, advance } = setup();
      await service.begin(call(), 'hash-a');

      advance(IN_FLIGHT_MS - 1);

      expect(await codeOf(service.begin(call(), 'hash-a'))).toBe('IDEMPOTENCY.IN_PROGRESS');
    });

    it('lets only one of several retries take over an expired reservation', async () => {
      const { service, store, call, advance } = setup();
      await service.begin(call(), 'hash-a');
      advance(IN_FLIGHT_MS);
      store.forcedTakeOverResult = false;

      expect(await codeOf(service.begin(call(), 'hash-a'))).toBe('IDEMPOTENCY.IN_PROGRESS');
    });

    it('asks the caller to retry when the row disappears between reserve and find', async () => {
      const { service, store, call } = setup();
      await service.begin(call(), 'hash-a');
      store.findReturnsNothing = true;

      expect(await codeOf(service.begin(call(), 'hash-a'))).toBe('IDEMPOTENCY.IN_PROGRESS');
    });

    it('keeps the same key independent for each actor', async () => {
      const { service, call } = setup();
      await service.begin(call(), 'hash-a');

      const other = await service.begin(call({ actorId: OTHER_ACTOR }), 'hash-b');

      expect(other.kind).toBe('proceed');
    });
  });

  describe('complete', () => {
    it('stores the response for 24 hours and runs inside the tenant scope', async () => {
      const { service, store, scopeCalls, call, now } = setup();
      const decision = await service.begin(call(), 'hash-a');
      if (decision.kind !== 'proceed') throw new Error('expected proceed');
      scopeCalls.length = 0;

      await service.complete(call(), decision.reservedUntil, 201, { id: 'user-9' });

      const row = store.rows.get(`${ACTOR}|${KEY}`);
      expect(row?.statusCode).toBe(201);
      expect(row?.body).toEqual({ id: 'user-9' });
      expect(row?.expiresAt).toEqual(new Date(now().getTime() + REPLAY_WINDOW_MS));
      expect(scopeCalls).toHaveLength(1);
    });

    it('stores an empty response as null', async () => {
      const { service, store, call } = setup();
      const decision = await service.begin(call(), 'hash-a');
      if (decision.kind !== 'proceed') throw new Error('expected proceed');

      await service.complete(call(), decision.reservedUntil, 204, undefined);

      expect(store.rows.get(`${ACTOR}|${KEY}`)?.body).toBeNull();
    });

    it.each([
      ['a password', { password: 'x' }],
      ['a nested token', { session: { accessToken: 'x' } }],
      ['recovery codes inside an array', [{ recoveryCodes: ['a'] }]],
    ])(
      'refuses to store a response that carries %s and keeps the reservation open',
      async (_label, body) => {
        const { service, store, call } = setup();
        const decision = await service.begin(call(), 'hash-a');
        if (decision.kind !== 'proceed') throw new Error('expected proceed');

        await expect(service.complete(call(), decision.reservedUntil, 201, body)).rejects.toThrow(
          'must not carry secrets',
        );

        expect(store.completeCalls).toBe(0);
        expect(store.rows.get(`${ACTOR}|${KEY}`)?.statusCode).toBeNull();
      },
    );

    it('does not overwrite a reservation that another request took over', async () => {
      const { service, store, call, advance } = setup();
      const slow = await service.begin(call(), 'hash-a');
      if (slow.kind !== 'proceed') throw new Error('expected proceed');
      advance(IN_FLIGHT_MS);
      const replacement = await service.begin(call(), 'hash-a');
      if (replacement.kind !== 'proceed') throw new Error('expected proceed');

      await service.complete(call(), slow.reservedUntil, 201, { id: 'stale' });

      expect(store.rows.get(`${ACTOR}|${KEY}`)?.statusCode).toBeNull();
    });
  });

  describe('release', () => {
    it('runs inside the tenant scope of the caller', async () => {
      const { service, scopeCalls, call } = setup();
      const decision = await service.begin(call(), 'hash-a');
      if (decision.kind !== 'proceed') throw new Error('expected proceed');
      scopeCalls.length = 0;

      await service.release(call(), decision.reservedUntil);

      // Sin el scope, el almacén real no tendría transacción y la organización no quedaría fijada.
      expect(scopeCalls).toEqual([
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
      ]);
    });

    it('frees the key so a retry runs again', async () => {
      const { service, call } = setup();
      const decision = await service.begin(call(), 'hash-a');
      if (decision.kind !== 'proceed') throw new Error('expected proceed');

      await service.release(call(), decision.reservedUntil);

      expect((await service.begin(call(), 'hash-a')).kind).toBe('proceed');
    });

    it('does not free a reservation that belongs to another request', async () => {
      const { service, store, call, advance } = setup();
      const slow = await service.begin(call(), 'hash-a');
      if (slow.kind !== 'proceed') throw new Error('expected proceed');
      advance(IN_FLIGHT_MS);
      await service.begin(call(), 'hash-a');

      await service.release(call(), slow.reservedUntil);

      expect(store.rows.has(`${ACTOR}|${KEY}`)).toBe(true);
    });

    it('does not free a completed response', async () => {
      const { service, store, call } = setup();
      const decision = await service.begin(call(), 'hash-a');
      if (decision.kind !== 'proceed') throw new Error('expected proceed');
      await service.complete(call(), decision.reservedUntil, 201, { id: 'user-9' });

      await service.release(call(), decision.reservedUntil);

      expect(store.rows.get(`${ACTOR}|${KEY}`)?.statusCode).toBe(201);
    });
  });
});
