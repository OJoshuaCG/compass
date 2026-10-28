import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  PgExpiredEphemeralStore,
  PgOrganizationLister,
  PurgeExpiredEphemeral,
} from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { asOrganizationId } from '../src/shared/kernel/index.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const NOW = new Date('2026-01-01T12:00:00.000Z');
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const LONG_AGO = new Date(NOW.getTime() - TWO_HOURS_MS);
const JUST_EXPIRED = new Date(NOW.getTime() - TEN_MINUTES_MS);
const IN_THE_FUTURE = new Date(NOW.getTime() + TWO_HOURS_MS);

let db: TestDatabase;
let orgA: string;
let orgB: string;
let userA: string;
let userB: string;
let purge: PurgeExpiredEphemeral;

async function seedUser(organizationId: string, email: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank) values ($1, $2, 'Seed', 0) returning id",
    [organizationId, email],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedKey(organizationId: string, actorId: string, expiresAt: Date): Promise<void> {
  await db.admin.query(
    `insert into idempotency_keys (organization_id, actor_id, key, request_hash, expires_at)
     values ($1, $2, $3, decode(repeat('ab', 32), 'hex'), $4)`,
    [organizationId, actorId, `key-${randomUUID()}`, expiresAt],
  );
}

async function seedChallenge(
  organizationId: string,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  await db.admin.query(
    `insert into webauthn_challenges (organization_id, user_id, session_id, purpose, challenge, expires_at)
     values ($1, $2, $3, 'authentication', $4, $5)`,
    [organizationId, userId, randomUUID(), `challenge-${randomUUID()}`, expiresAt],
  );
}

async function count(table: string, organizationId: string): Promise<number> {
  const result = await db.admin.query<{ total: string }>(
    `select count(*) as total from ${table} where organization_id = $1`,
    [organizationId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('purge-a');
  orgB = await db.seedOrganization('purge-b');
  userA = await seedUser(orgA, 'user@purge-a.test');
  userB = await seedUser(orgB, 'user@purge-b.test');

  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  purge = new PurgeExpiredEphemeral({
    organizations: new PgOrganizationLister(db.appPool),
    store: new PgExpiredEphemeralStore(uow),
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock: { now: () => NOW },
  });
});

afterAll(async () => {
  await db.close();
});

describe('PurgeExpiredEphemeral', () => {
  it('deletes rows expired beyond the grace period in every organization and keeps the rest', async () => {
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ] as const) {
      await seedKey(org, user, LONG_AGO);
      await seedKey(org, user, JUST_EXPIRED);
      await seedKey(org, user, IN_THE_FUTURE);
      await seedChallenge(org, user, LONG_AGO);
      await seedChallenge(org, user, JUST_EXPIRED);
      await seedChallenge(org, user, IN_THE_FUTURE);
    }

    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([]);
    expect(summary.idempotencyKeys).toBe(2);
    expect(summary.webauthnChallenges).toBe(2);
    for (const org of [orgA, orgB]) {
      // Sobreviven la que venció hace poco (margen de gracia) y la vigente.
      expect(await count('idempotency_keys', org)).toBe(2);
      expect(await count('webauthn_challenges', org)).toBe(2);
    }
  });

  it('cannot delete rows of another organization even with a cutoff that matches them all', async () => {
    const requestContext = new AsyncLocalRequestContext();
    const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
    const scope = new PgTenantScope(requestContext, uow);
    const store = new PgExpiredEphemeralStore(uow);
    const beforeB = await count('idempotency_keys', orgB);
    const challengesBeforeB = await count('webauthn_challenges', orgB);
    const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

    const deletedAsA = await scope.runAs(
      { organizationId: asOrganizationId(orgA), actorId: null, requestId: 'req-isolation' },
      async () => ({
        keys: await store.purgeIdempotencyKeys(FAR_FUTURE, 1000),
        challenges: await store.purgeWebauthnChallenges(FAR_FUTURE, 1000),
      }),
    );

    // Todo lo de A cae (incluso lo vigente, por el corte) y nada de B se toca.
    expect(deletedAsA).toEqual({ keys: 2, challenges: 2 });
    expect(await count('idempotency_keys', orgA)).toBe(0);
    expect(await count('idempotency_keys', orgB)).toBe(beforeB);
    expect(await count('webauthn_challenges', orgB)).toBe(challengesBeforeB);
  });

  it('is idempotent: a second run deletes nothing', async () => {
    const summary = await purge.execute();

    expect(summary.idempotencyKeys).toBe(0);
    expect(summary.webauthnChallenges).toBe(0);
  });

  it('only lists organization ids to the application role', async () => {
    const lister = new PgOrganizationLister(db.appPool);

    const ids = await lister.listIds();

    expect(ids).toEqual(expect.arrayContaining([orgA, orgB]));
    // La tabla sigue protegida: sin organización fijada, el rol no ve ninguna fila.
    const direct = await db.appPool.query('select id from organizations');
    expect(direct.rowCount).toBe(0);
  });
});
