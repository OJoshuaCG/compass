import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { AsyncLocalRequestContext } from '../../../shared/infrastructure/async-local-request-context.js';
import { asOrganizationId, asUserId, err, ok } from '../../../shared/kernel/index.js';
import type { RequestContext, RequestContextRunner } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../application/ports/unit-of-work.js';
import { PgTenantScope } from './pg-tenant-scope.js';
import { PgUnitOfWork } from './pg-unit-of-work.js';

const ORGANIZATION = asOrganizationId('org-1');
const ACTOR = asUserId('user-1');

function setup() {
  const events: string[] = [];
  const contextsSeen: RequestContext[] = [];
  const rolledBack: boolean[] = [];

  // Como `AsyncLocalStorage.run`, el contexto sigue vivo hasta que termina el trabajo asíncrono: la
  // salida se registra cuando la promesa se asienta, no cuando `fn()` devuelve.
  const contexts: RequestContextRunner = {
    run: (context, fn) => {
      events.push('context:enter');
      contextsSeen.push(context);
      const result = fn();
      if (result instanceof Promise) {
        return result.finally(() => {
          events.push('context:exit');
        }) as typeof result;
      }
      events.push('context:exit');
      return result;
    },
  };
  // Imita `PgUnitOfWork`: confirma si el trabajo termina y revierte solo si lanza.
  const uow: UnitOfWork = {
    run: async (fn) => {
      events.push('uow:begin');
      try {
        const result = await fn();
        events.push('uow:commit');
        rolledBack.push(false);
        return result;
      } catch (error) {
        events.push('uow:rollback');
        rolledBack.push(true);
        throw error;
      }
    },
    runIndependent: (fn) => fn(),
  };

  return { scope: new PgTenantScope(contexts, uow), events, contextsSeen, rolledBack };
}

describe('PgTenantScope', () => {
  describe('runAs', () => {
    it('sets the context first and runs the transaction inside it', async () => {
      const { scope, events } = setup();

      await scope.runAs(
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
        () => {
          events.push('work');
          return Promise.resolve();
        },
      );

      expect(events).toEqual(['context:enter', 'uow:begin', 'work', 'uow:commit', 'context:exit']);
    });

    it('fills the optional session fields with null', async () => {
      const { scope, contextsSeen } = setup();

      await scope.runAs({ organizationId: ORGANIZATION, actorId: null, requestId: 'req-1' }, () =>
        Promise.resolve(),
      );

      expect(contextsSeen[0]).toEqual({
        organizationId: ORGANIZATION,
        actorId: null,
        requestId: 'req-1',
        sessionId: null,
        reauthAt: null,
      });
    });

    it('keeps the session and the reauthentication instant when they are given', async () => {
      const { scope, contextsSeen } = setup();
      const reauthAt = new Date('2026-01-15T10:00:00.000Z');

      await scope.runAs(
        {
          organizationId: ORGANIZATION,
          actorId: ACTOR,
          requestId: 'req-1',
          sessionId: 's-1',
          reauthAt,
        },
        () => Promise.resolve(),
      );

      expect(contextsSeen[0]).toMatchObject({ sessionId: 's-1', reauthAt });
    });

    it('returns what the work returns', async () => {
      const { scope } = setup();

      const result = await scope.runAs(
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
        () => Promise.resolve('done'),
      );

      expect(result).toBe('done');
    });

    it('does not roll back an expected error result: only a thrown error rolls back', async () => {
      const { scope, rolledBack } = setup();

      const result = await scope.runAs(
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
        () => Promise.resolve(err('NOT_ALLOWED')),
      );

      expect(result).toEqual(err('NOT_ALLOWED'));
      expect(rolledBack).toEqual([false]);
    });

    it('rolls back and rethrows the original error when the work throws', async () => {
      const { scope, rolledBack } = setup();
      const failure = new Error('boom');

      await expect(
        scope.runAs({ organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' }, () =>
          Promise.reject(failure),
        ),
      ).rejects.toBe(failure);

      expect(rolledBack).toEqual([true]);
    });
  });

  describe('with the real request context and unit of work', () => {
    it('fixes the organization of runAs as the transaction organization', async () => {
      const queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
      const client = {
        query: (text: string, values?: readonly unknown[]): Promise<void> => {
          queries.push({ text, values });
          return Promise.resolve();
        },
        release: (): void => undefined,
      };
      const pool = { connect: (): Promise<unknown> => Promise.resolve(client) } as unknown as Pool;
      const context = new AsyncLocalRequestContext();
      const scope = new PgTenantScope(context, new PgUnitOfWork(pool, context, pool));

      await scope.runAs({ organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' }, () =>
        Promise.resolve(),
      );

      const setConfig = queries.find((query) => query.text.startsWith('select set_config'));
      expect(setConfig?.values).toEqual([ORGANIZATION]);
    });
  });

  describe('runAsAtomic', () => {
    it('commits and returns a successful result', async () => {
      const { scope, rolledBack } = setup();

      const result = await scope.runAsAtomic(
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
        () => Promise.resolve(ok('created')),
      );

      expect(result).toEqual(ok('created'));
      expect(rolledBack).toEqual([false]);
    });

    it('rolls back everything and returns the same error when the work returns an error', async () => {
      const { scope, rolledBack } = setup();
      const outcome = err('DUPLICATE');

      const result = await scope.runAsAtomic(
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
        () => Promise.resolve(outcome),
      );

      expect(result).toBe(outcome);
      expect(rolledBack).toEqual([true]);
    });

    it('does not leak its internal rollback signal to the caller', async () => {
      const { scope } = setup();

      const outcome = await scope.runAsAtomic(
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
        () => Promise.resolve(err('DUPLICATE')),
      );

      expect(outcome).not.toBeInstanceOf(Error);
      expect(outcome.ok).toBe(false);
    });

    it('rethrows a real error instead of turning it into a result', async () => {
      const { scope, rolledBack } = setup();
      const failure = new Error('boom');

      await expect(
        scope.runAsAtomic(
          { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
          () => Promise.reject(failure),
        ),
      ).rejects.toBe(failure);

      expect(rolledBack).toEqual([true]);
    });

    it('runs the work inside the context and the transaction', async () => {
      const { scope, events, contextsSeen } = setup();

      await scope.runAsAtomic(
        { organizationId: ORGANIZATION, actorId: ACTOR, requestId: 'req-1' },
        () => {
          events.push('work');
          return Promise.resolve(ok(null));
        },
      );

      expect(events.slice(0, 3)).toEqual(['context:enter', 'uow:begin', 'work']);
      expect(contextsSeen[0]?.organizationId).toBe(ORGANIZATION);
    });
  });
});
