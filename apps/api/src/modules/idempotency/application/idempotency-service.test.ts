import { describe, expect, it } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { CryptoPrimitives } from '../../crypto/index.js';
import type { ScopeContext, TenantScope } from '../../organization/index.js';
import { IdempotencyService, IN_FLIGHT_MS } from './idempotency-service.js';
import type { IdempotencyStore, StoredResponse } from './ports/idempotency-store.js';

const NOW = new Date('2030-01-10T12:00:00.000Z');
const CALL = {
  organizationId: asOrganizationId('0190a000-0000-7000-8000-00000000000a'),
  actorId: asUserId('0190a000-0000-7000-8000-0000000000aa'),
  requestId: 'req-1',
  key: 'retry-key-0001',
};
const HASH = 'ab'.repeat(32);

const scope: TenantScope = {
  runAs: <T>(_context: ScopeContext, fn: () => Promise<T>) => fn(),
  runAsAtomic: () => {
    throw new Error('not used');
  },
};

/** Almacén en memoria con una sola clave; `onBeforeTakeOver` simula lo que pasa entre `find` y `takeOver`. */
class MemoryStore implements IdempotencyStore {
  row: StoredResponse | null;
  onBeforeTakeOver: () => void = () => undefined;

  constructor(row: StoredResponse | null) {
    this.row = row;
  }

  reserve(input: { requestHash: string; expiresAt: Date }): Promise<boolean> {
    if (this.row !== null) return Promise.resolve(false);
    this.row = {
      requestHash: input.requestHash,
      statusCode: null,
      body: null,
      expiresAt: input.expiresAt,
    };
    return Promise.resolve(true);
  }

  find(): Promise<StoredResponse | null> {
    return Promise.resolve(this.row);
  }

  takeOver(input: { requestHash: string; now: Date; expiresAt: Date }): Promise<boolean> {
    this.onBeforeTakeOver();
    if (this.row === null || this.row.expiresAt > input.now) return Promise.resolve(false);
    this.row = {
      requestHash: input.requestHash,
      statusCode: null,
      body: null,
      expiresAt: input.expiresAt,
    };
    return Promise.resolve(true);
  }

  complete(): Promise<void> {
    return Promise.resolve();
  }

  release(): Promise<void> {
    return Promise.resolve();
  }
}

const expiredResponse = (): StoredResponse => ({
  requestHash: HASH,
  statusCode: 201,
  body: { id: 'x' },
  expiresAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
});

function service(store: IdempotencyStore) {
  return new IdempotencyService({
    scope,
    store,
    primitives: {} as CryptoPrimitives,
    clock: { now: () => NOW },
  });
}

describe('IdempotencyService.begin with an expired key', () => {
  it('takes over the expired key and proceeds', async () => {
    const store = new MemoryStore(expiredResponse());
    await expect(service(store).begin(CALL, HASH)).resolves.toEqual({
      kind: 'proceed',
      reservedUntil: new Date(NOW.getTime() + IN_FLIGHT_MS),
    });
  });

  it('proceeds when the purge deleted the row between find and takeOver', async () => {
    const store = new MemoryStore(expiredResponse());
    store.onBeforeTakeOver = () => {
      store.row = null;
    };
    await expect(service(store).begin(CALL, HASH)).resolves.toMatchObject({ kind: 'proceed' });
    expect(store.row?.statusCode).toBeNull();
  });

  it('stays "in progress" when another request took the key over first', async () => {
    const store = new MemoryStore(expiredResponse());
    store.onBeforeTakeOver = () => {
      store.row = {
        requestHash: HASH,
        statusCode: null,
        body: null,
        expiresAt: new Date(NOW.getTime() + IN_FLIGHT_MS),
      };
    };
    await expect(service(store).begin(CALL, HASH)).rejects.toMatchObject({
      code: 'IDEMPOTENCY.IN_PROGRESS',
    });
  });
});
