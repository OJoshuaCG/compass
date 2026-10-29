import { describe, expect, it } from 'vitest';

import { asOrganizationId, type OrganizationId } from '../../../shared/kernel/index.js';
import type { ScopeContext, TenantScope } from '../../organization/index.js';
import type { ExpiredRowsPurger } from './ports/maintenance-ports.js';
import { PURGE_BATCH_SIZE, PURGE_GRACE_MS, PurgeExpiredRows } from './purge-expired-rows.js';

const NOW = new Date('2030-01-10T12:00:00.000Z');
const ORG_A = asOrganizationId('0190a000-0000-7000-8000-00000000000a');
const ORG_B = asOrganizationId('0190a000-0000-7000-8000-00000000000b');

/** Ámbito falso: registra con qué contexto se abrió cada transacción y cuál está activo. */
class RecordingScope implements TenantScope {
  readonly contexts: ScopeContext[] = [];
  active: OrganizationId | null = null;

  async runAs<T>(context: ScopeContext, fn: () => Promise<T>): Promise<T> {
    this.contexts.push(context);
    this.active = context.organizationId;
    try {
      return await fn();
    } finally {
      this.active = null;
    }
  }

  runAsAtomic(): never {
    throw new Error('not used by the purge');
  }
}

/** Purgador falso: filas vencidas pendientes por organización, borradas por lotes. */
class FakePurger implements ExpiredRowsPurger {
  readonly cutoffs: Date[] = [];

  constructor(
    readonly table: string,
    private readonly scope: RecordingScope,
    private readonly pending: Map<OrganizationId, number>,
  ) {}

  async purgeBatch(cutoff: Date, limit: number): Promise<number> {
    this.cutoffs.push(cutoff);
    // Sin organización activa no hay nada que borrar, igual que con RLS.
    if (this.scope.active === null) return 0;
    const left = this.pending.get(this.scope.active) ?? 0;
    const removed = Math.min(left, limit);
    this.pending.set(this.scope.active, left - removed);
    return Promise.resolve(removed);
  }
}

function setup(pendingA: number, pendingB: number) {
  const scope = new RecordingScope();
  const keys = new FakePurger(
    'idempotency_keys',
    scope,
    new Map([
      [ORG_A, pendingA],
      [ORG_B, pendingB],
    ]),
  );
  const challenges = new FakePurger('webauthn_challenges', scope, new Map([[ORG_A, 3]]));
  let n = 0;
  const useCase = new PurgeExpiredRows({
    organizations: { listIds: () => Promise.resolve([ORG_A, ORG_B]) },
    scope,
    purgers: [keys, challenges],
    clock: { now: () => NOW },
    ids: { next: () => `id-${String((n += 1))}` },
  });
  return { scope, keys, challenges, useCase };
}

describe('PurgeExpiredRows', () => {
  it('purges every table of every organization and reports the totals', async () => {
    const { useCase } = setup(5, 7);
    await expect(useCase.execute()).resolves.toEqual({
      organizations: 2,
      deleted: { idempotency_keys: 12, webauthn_challenges: 3 },
    });
  });

  it('only deletes rows expired more than the grace period ago', async () => {
    const { useCase, keys, challenges } = setup(1, 0);
    await useCase.execute();
    const expected = new Date(NOW.getTime() - PURGE_GRACE_MS);
    for (const cutoff of [...keys.cutoffs, ...challenges.cutoffs]) {
      expect(cutoff).toEqual(expected);
    }
    expect(PURGE_GRACE_MS).toBe(60 * 60 * 1000);
  });

  it('keeps deleting in batches until a batch comes back incomplete', async () => {
    const { useCase, keys } = setup(PURGE_BATCH_SIZE * 2 + 1, 0);
    const report = await useCase.execute();
    expect(report.deleted['idempotency_keys']).toBe(PURGE_BATCH_SIZE * 2 + 1);
    // Organización A: 3 lotes (lleno, lleno, incompleto). Organización B: 1 lote vacío.
    expect(keys.cutoffs).toHaveLength(4);
  });

  it('runs each batch in its own transaction, as a system process scoped to one organization', async () => {
    const { useCase, scope } = setup(PURGE_BATCH_SIZE, 0);
    await useCase.execute();
    expect(scope.contexts.length).toBeGreaterThan(1);
    for (const context of scope.contexts) {
      expect(context.actorId).toBeNull();
      expect([ORG_A, ORG_B]).toContain(context.organizationId);
    }
    const requestIds = scope.contexts.map((context) => context.requestId);
    expect(new Set(requestIds).size).toBe(requestIds.length);
  });

  it('propagates a database failure so the scheduler sees the job fail', async () => {
    const scope = new RecordingScope();
    const useCase = new PurgeExpiredRows({
      organizations: { listIds: () => Promise.resolve([ORG_A]) },
      scope,
      purgers: [
        { table: 'idempotency_keys', purgeBatch: () => Promise.reject(new Error('db down')) },
      ],
      clock: { now: () => NOW },
      ids: { next: () => 'id' },
    });
    await expect(useCase.execute()).rejects.toThrow('db down');
  });

  it('does nothing when there are no organizations', async () => {
    const scope = new RecordingScope();
    const useCase = new PurgeExpiredRows({
      organizations: { listIds: () => Promise.resolve([]) },
      scope,
      purgers: [],
      clock: { now: () => NOW },
      ids: { next: () => 'id' },
    });
    await expect(useCase.execute()).resolves.toEqual({ organizations: 0, deleted: {} });
    expect(scope.contexts).toEqual([]);
  });
});
