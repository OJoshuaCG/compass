import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { asOrganizationId, DomainError } from '../../../shared/kernel/index.js';
import type { RequestContext, RequestContextReader } from '../../../shared/kernel/index.js';
import { PgUnitOfWork } from './pg-unit-of-work.js';

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];
  /** Texto de la consulta que debe fallar (por ejemplo `rollback`), si alguna. */
  failOn: string | undefined;
  /** `undefined` = no se liberó; `false` = devuelta al pool; `true` = destruida. */
  released: boolean | undefined;

  query(text: string, values?: readonly unknown[]): Promise<void> {
    this.queries.push({ text, values });
    if (this.failOn !== undefined && text.startsWith(this.failOn)) {
      return Promise.reject(new Error(`${this.failOn} failed`));
    }
    return Promise.resolve();
  }

  release(discard?: boolean): void {
    this.released = discard ?? false;
  }

  get texts(): string[] {
    return this.queries.map((query) => query.text);
  }
}

class FakePool {
  readonly clients: FakeClient[] = [];
  /** Configuración que se aplica a cada cliente nuevo antes de entregarlo. */
  prepare: (client: FakeClient) => void = () => undefined;

  connect(): Promise<PoolClient> {
    const client = new FakeClient();
    this.prepare(client);
    this.clients.push(client);
    return Promise.resolve(client as unknown as PoolClient);
  }
}

const ORGANIZATION = asOrganizationId('0b6f6c1e-0000-4000-8000-000000000001');
const OTHER_ORGANIZATION = asOrganizationId('0b6f6c1e-0000-4000-8000-000000000002');

function contextOf(organizationId = ORGANIZATION): RequestContext {
  return { organizationId, actorId: null, requestId: 'req-1', sessionId: null, reauthAt: null };
}

function setup(reader?: RequestContextReader) {
  const pool = new FakePool();
  const independentPool = new FakePool();
  const context = reader ?? { current: () => contextOf() };
  const uow = new PgUnitOfWork(
    pool as unknown as Pool,
    context,
    independentPool as unknown as Pool,
  );
  return { uow, pool, independentPool };
}

describe('PgUnitOfWork', () => {
  it('sets the organization from the request context before running anything', async () => {
    const { uow, pool } = setup();

    await uow.run(() => {
      uow.current();
      return Promise.resolve();
    });

    const client = pool.clients[0];
    expect(client?.texts).toEqual(['begin', "select set_config('app.org_id', $1, true)", 'commit']);
    expect(client?.queries[1]?.values).toEqual([ORGANIZATION]);
  });

  it('never takes the organization from the caller: a different context gives a different value', async () => {
    const { uow, pool } = setup({ current: () => contextOf(OTHER_ORGANIZATION) });

    await uow.run(() => Promise.resolve());

    expect(pool.clients[0]?.queries[1]?.values).toEqual([OTHER_ORGANIZATION]);
  });

  it('returns what the work returns and gives the connection back to the pool', async () => {
    const { uow, pool } = setup();

    const result = await uow.run(() => Promise.resolve('done'));

    expect(result).toBe('done');
    expect(pool.clients[0]?.released).toBe(false);
  });

  it('rolls everything back, rethrows the original error and releases the connection', async () => {
    const { uow, pool } = setup();
    const failure = new Error('use case failed');

    await expect(uow.run(() => Promise.reject(failure))).rejects.toBe(failure);

    const client = pool.clients[0];
    expect(client?.texts).toContain('rollback');
    expect(client?.texts).not.toContain('commit');
    expect(client?.released).toBe(false);
  });

  it('rolls back when fixing the organization fails, so the work never runs', async () => {
    const { uow, pool } = setup();
    pool.prepare = (client) => {
      client.failOn = 'select set_config';
    };
    let ran = false;

    await expect(
      uow.run(() => {
        ran = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow('select set_config failed');

    expect(ran).toBe(false);
    expect(pool.clients[0]?.texts).toContain('rollback');
  });

  it('destroys the connection when the rollback itself fails and still throws the original error', async () => {
    const { uow, pool } = setup();
    pool.prepare = (client) => {
      client.failOn = 'rollback';
    };
    const failure = new Error('use case failed');

    await expect(uow.run(() => Promise.reject(failure))).rejects.toBe(failure);

    expect(pool.clients[0]?.released).toBe(true);
  });

  it('releases the connection when the commit fails', async () => {
    const { uow, pool } = setup();
    pool.prepare = (client) => {
      client.failOn = 'commit';
    };

    await expect(uow.run(() => Promise.resolve())).rejects.toThrow('commit failed');

    expect(pool.clients[0]?.released).toBe(false);
  });

  it('joins a nested call to the running transaction instead of opening another one', async () => {
    const { uow, pool } = setup();

    await uow.run(async () => {
      const outer = uow.current();
      await uow.run(() => {
        expect(uow.current()).toBe(outer);
        return Promise.resolve();
      });
    });

    expect(pool.clients).toHaveLength(1);
    expect(pool.clients[0]?.texts.filter((text) => text === 'begin')).toHaveLength(1);
  });

  it('refuses to hand out a connection outside a transaction', () => {
    const { uow } = setup();

    expect(() => uow.current()).toThrow(DomainError);
    expect(() => uow.current()).toThrow(expect.objectContaining({ code: 'AUTHZ.TENANT' }) as Error);
  });

  it('forgets the transaction once it ends', async () => {
    const { uow } = setup();
    await uow.run(() => Promise.resolve());

    expect(() => uow.current()).toThrow(DomainError);
  });

  it('fails closed without opening a connection when there is no request context', async () => {
    const { uow, pool } = setup({
      current: () => {
        throw new DomainError('AUTHZ.TENANT', 'No request context');
      },
    });

    await expect(uow.run(() => Promise.resolve())).rejects.toMatchObject({ code: 'AUTHZ.TENANT' });

    expect(pool.clients).toHaveLength(0);
  });

  it('gives each concurrent transaction its own connection', async () => {
    const { uow, pool } = setup();
    const seen: PoolClient[] = [];
    const work = async (): Promise<void> => {
      await Promise.resolve();
      seen.push(uow.current());
      await Promise.resolve();
    };

    await Promise.all([uow.run(work), uow.run(work)]);

    expect(pool.clients).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  describe('runIndependent', () => {
    it('uses its own pool so requests holding a connection cannot starve each other', async () => {
      const { uow, pool, independentPool } = setup();

      await uow.runIndependent(() => Promise.resolve());

      expect(pool.clients).toHaveLength(0);
      expect(independentPool.clients).toHaveLength(1);
      expect(independentPool.clients[0]?.texts).toEqual([
        'begin',
        "select set_config('app.org_id', $1, true)",
        'commit',
      ]);
    });

    it('opens a separate transaction even from inside a running one', async () => {
      const { uow, pool, independentPool } = setup();

      await uow.run(async () => {
        const outer = uow.current();
        await uow.runIndependent(() => {
          expect(uow.current()).not.toBe(outer);
          return Promise.resolve();
        });
        expect(uow.current()).toBe(outer);
      });

      expect(pool.clients).toHaveLength(1);
      expect(independentPool.clients).toHaveLength(1);
    });

    it('fails closed without opening a connection when there is no request context', async () => {
      const { uow, independentPool } = setup({
        current: () => {
          throw new DomainError('AUTHZ.TENANT', 'No request context');
        },
      });

      await expect(uow.runIndependent(() => Promise.resolve())).rejects.toMatchObject({
        code: 'AUTHZ.TENANT',
      });

      expect(independentPool.clients).toHaveLength(0);
    });

    it('rolls back, rethrows the original error and releases its connection when the work throws', async () => {
      const { uow, independentPool } = setup();
      const failure = new Error('independent work failed');

      await expect(uow.runIndependent(() => Promise.reject(failure))).rejects.toBe(failure);

      const client = independentPool.clients[0];
      expect(client?.texts).toContain('rollback');
      expect(client?.texts).not.toContain('commit');
      expect(client?.released).toBe(false);
    });

    it('commits independently: a failure of the outer transaction does not undo it', async () => {
      const { uow, independentPool } = setup();

      await expect(
        uow.run(async () => {
          await uow.runIndependent(() => Promise.resolve());
          throw new Error('outer failed');
        }),
      ).rejects.toThrow('outer failed');

      expect(independentPool.clients[0]?.texts).toContain('commit');
    });
  });
});
