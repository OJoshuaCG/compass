import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgUserDirectory } from '../src/modules/directory/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

interface SeededChain {
  readonly organizationId: string;
  readonly rootId: string;
  readonly adminId: string;
  readonly leaderId: string;
  readonly memberId: string;
}

let db: TestDatabase;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let chainA: SeededChain;
let chainB: SeededChain;

async function insertUser(
  organizationId: string,
  label: string,
  rank: number,
  managedBy: string | null,
  status = 'active',
): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, status, managed_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [organizationId, `${label}@${organizationId}.test`, label, rank, status, managedBy],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

/** Raíz (0) > Administrador (1) > Líder (2, dado de baja a propósito) > Miembro (3). */
async function seedChain(slug: string): Promise<SeededChain> {
  const organizationId = await db.seedOrganization(slug);
  const rootId = await insertUser(organizationId, 'root', 0, null);
  const adminId = await insertUser(organizationId, 'admin', 1, rootId);
  const leaderId = await insertUser(organizationId, 'leader', 2, adminId, 'suspended');
  const memberId = await insertUser(organizationId, 'member', 3, leaderId);
  return { organizationId, rootId, adminId, leaderId, memberId };
}

async function chainOf(chain: SeededChain, userId: string) {
  return requestContext.run(contextFor(chain.organizationId), () =>
    uow.run(() => new PgUserDirectory(uow).listSuperiorChain(asUserId(userId))),
  );
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  chainA = await seedChain('superior-chain-a');
  chainB = await seedChain('superior-chain-b');
});

afterAll(async () => {
  await db.close();
});

describe('UserDirectory.listSuperiorChain against PostgreSQL', () => {
  it('lists the superiors nearest first, ending at the Root, without the person itself', async () => {
    const chain = await chainOf(chainA, chainA.memberId);

    expect(chain.map((link) => link.id)).toEqual([chainA.leaderId, chainA.adminId, chainA.rootId]);
    expect(chain.map((link) => link.rank)).toEqual([2, 1, 0]);
  });

  it('does not filter by status: the caller decides who counts', async () => {
    const chain = await chainOf(chainA, chainA.memberId);

    expect(chain[0]?.status).toBe('suspended');
    expect(chain[1]?.status).toBe('active');
  });

  it('returns an empty chain for the Root', async () => {
    expect(await chainOf(chainA, chainA.rootId)).toEqual([]);
  });

  it('never returns people of another organization (row-level isolation)', async () => {
    const wrongOrganization = await chainOf(chainB, chainA.memberId);

    expect(wrongOrganization).toEqual([]);
  });
});
