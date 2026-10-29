import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgExpiredChallengesPurger } from '../src/modules/identity/index.js';
import { PgExpiredIdempotencyKeysPurger } from '../src/modules/idempotency/index.js';
import { PurgeExpiredRows } from '../src/modules/maintenance/index.js';
import {
  PgOrganizationLister,
  PgTenantScope,
  PgUnitOfWork,
} from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

// ADR 0038: el caso de uso real (listador, purgadores y SQL publicados) contra una base migrada.

let db: TestDatabase;
let orgA: string;
let orgB: string;
let purge: PurgeExpiredRows;

/** Vencida hace 2 h (se borra), hace 30 min (margen de gracia: se conserva) y vigente. */
const AGES = { old: '-2 hours', grace: '-30 minutes', live: '1 hour' } as const;

async function seed(org: string): Promise<void> {
  const { rows } = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Root', 0, 'active') returning id`,
    [org, `root-${org}@purge.test`],
  );
  const userId = rows[0]?.id;
  for (const [tag, age] of Object.entries(AGES)) {
    await db.admin.query(
      `insert into idempotency_keys (organization_id, key, actor_id, request_hash, expires_at)
       values ($1, $2, $3, decode(repeat('ab', 32), 'hex'), now() + $4::interval)`,
      [org, `purge-${tag}-key`, userId, age],
    );
    await db.admin.query(
      `insert into webauthn_challenges (organization_id, user_id, session_id, purpose, challenge, expires_at)
       values ($1, $2, gen_random_uuid(), 'authentication', $3, now() + $4::interval)`,
      [org, userId, `purge-${tag}-0123456789`, age],
    );
  }
}

const remaining = async (table: string, org: string): Promise<string[]> => {
  const column = table === 'idempotency_keys' ? 'key' : 'challenge';
  const { rows } = await db.admin.query<{ v: string }>(
    `select ${column} as v from ${table} where organization_id = $1 order by 1`,
    [org],
  );
  return rows.map((row) => row.v.replace(/^purge-(\w+)-.*$/, '$1'));
};

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('org-a');
  orgB = await db.seedOrganization('org-b');
  await seed(orgA);
  await seed(orgB);
  const contexts = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(db.appPool, contexts, db.independentPool);
  let n = 0;
  purge = new PurgeExpiredRows({
    organizations: new PgOrganizationLister(db.appPool),
    scope: new PgTenantScope(contexts, uow),
    purgers: [new PgExpiredIdempotencyKeysPurger(uow), new PgExpiredChallengesPurger(uow)],
    clock: { now: () => new Date() },
    ids: { next: () => `purge-test-${String((n += 1))}` },
  });
});

afterAll(async () => {
  await db.close();
});

describe('PurgeExpiredRows against PostgreSQL', () => {
  it('lists the organizations through auth.list_organization_ids()', async () => {
    const ids = await new PgOrganizationLister(db.appPool).listIds();
    expect([...ids].sort()).toEqual([orgA, orgB].sort());
  });

  it('deletes only rows expired beyond the grace period, in every organization', async () => {
    const report = await purge.execute();
    expect(report).toEqual({
      organizations: 2,
      deleted: { idempotency_keys: 2, webauthn_challenges: 2 },
    });
    for (const org of [orgA, orgB]) {
      expect(await remaining('idempotency_keys', org)).toEqual(['grace', 'live']);
      expect(await remaining('webauthn_challenges', org)).toEqual(['grace', 'live']);
    }
  });

  it('is idempotent: a second run deletes nothing', async () => {
    await expect(purge.execute()).resolves.toEqual({
      organizations: 2,
      deleted: { idempotency_keys: 0, webauthn_challenges: 0 },
    });
  });
});
