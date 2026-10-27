import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

let db: TestDatabase;
let orgA: string;
let orgB: string;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('org-a');
  orgB = await db.seedOrganization('org-b');
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
});

afterAll(async () => {
  await db.close();
});

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

describe('PgUnitOfWork', () => {
  it('sets app.org_id to the organization of the request context for the whole transaction', async () => {
    const seen = await inOrg(orgA, async () => {
      const first = await uow
        .current()
        .query<{ v: string }>("select current_setting('app.org_id') as v");
      const second = await uow
        .current()
        .query<{ v: string }>("select current_setting('app.org_id') as v");
      return [first.rows[0]?.v, second.rows[0]?.v];
    });

    expect(seen).toEqual([orgA, orgA]);
  });

  it('does not leak app.org_id to the next user of the pooled connection', async () => {
    const single = new (await import('pg')).Pool({ connectionString: db.appUrl, max: 1 });
    const isolated = new PgUnitOfWork(single, requestContext, db.independentPool);
    try {
      await requestContext.run(contextFor(orgA), () => isolated.run(() => Promise.resolve()));

      const after = await single.query<{ v: string | null }>(
        "select nullif(current_setting('app.org_id', true), '') as v",
      );

      expect(after.rows[0]?.v).toBeNull();
    } finally {
      await single.end();
    }
  });

  it('rolls back everything when the callback throws', async () => {
    const aggregate = `rollback-${String(Date.now())}`;

    await expect(
      inOrg(orgA, async () => {
        await uow
          .current()
          .query(
            "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, $2, 't', '{}')",
            [orgA, aggregate],
          );
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');

    const count = await db.admin.query<{ n: string }>(
      'select count(*) as n from outbox_events where aggregate = $1',
      [aggregate],
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  it('commits when the callback succeeds', async () => {
    const aggregate = `commit-${String(Date.now())}`;

    await inOrg(orgA, async () => {
      await uow
        .current()
        .query(
          "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, $2, 't', '{}')",
          [orgA, aggregate],
        );
    });

    const count = await db.admin.query<{ n: string }>(
      'select count(*) as n from outbox_events where aggregate = $1',
      [aggregate],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('runIndependent commits on its own even when the caller transaction rolls back', async () => {
    const aggregate = `independent-${String(Date.now())}`;

    await expect(
      inOrg(orgA, async () => {
        const outer = uow.current();
        await uow.runIndependent(async () => {
          expect(uow.current()).not.toBe(outer);
          await uow
            .current()
            .query(
              "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, $2, 't', '{}')",
              [orgA, aggregate],
            );
        });
        expect(uow.current()).toBe(outer);
        throw new Error('caller rolls back');
      }),
    ).rejects.toThrow('caller rolls back');

    const count = await db.admin.query<{ n: string }>(
      'select count(*) as n from outbox_events where aggregate = $1',
      [aggregate],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('fails closed outside of a transaction', () => {
    expect(() => uow.current()).toThrow(/No active transaction/);
  });

  it('fails closed without a request context (no organization resolved)', async () => {
    await expect(uow.run(() => Promise.resolve())).rejects.toThrow(/No request context/);
  });

  it('joins a nested run to the same transaction', async () => {
    const same = await inOrg(orgA, async () => {
      const outer = uow.current();
      return uow.run(() => Promise.resolve(uow.current() === outer));
    });

    expect(same).toBe(true);
  });

  it('isolates organizations: A cannot see or write B rows through the application role', async () => {
    const aggregate = `iso-${String(Date.now())}`;
    await inOrg(orgB, async () => {
      await uow
        .current()
        .query(
          "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, $2, 't', '{}')",
          [orgB, aggregate],
        );
    });

    const seenByA = await inOrg(orgA, async () => {
      const rows = await uow
        .current()
        .query('select 1 from outbox_events where aggregate = $1', [aggregate]);
      return rows.rowCount;
    });
    expect(seenByA).toBe(0);

    await expect(
      inOrg(orgA, async () => {
        await uow
          .current()
          .query(
            "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, 'x', 't', '{}')",
            [orgB],
          );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('returns zero rows when no organization is bound (fail closed)', async () => {
    const rows = await db.appPool.query('select 1 from outbox_events');
    expect(rows.rowCount).toBe(0);
  });
});
