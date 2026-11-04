/**
 * SENSIBLE (ruta protegida: acceso a la bóveda). Esta prueba la debe revisar una persona.
 *
 * Cubre el adaptador de bajas contra PostgreSQL real: qué cuentas se quedan sin responsable al dar de baja
 * a una persona y cómo se le concede la gestión a quien las recibe.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgOffboardingAccountStore } from '../src/modules/vault/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

interface SeededOrganization {
  readonly organizationId: string;
  readonly rootId: string;
  readonly leaverId: string;
  readonly colleagueId: string;
  readonly suspendedColleagueId: string;
}

let db: TestDatabase;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let orgA: SeededOrganization;
let orgB: SeededOrganization;

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

async function insertAccount(
  organizationId: string,
  createdBy: string,
  name: string,
  status = 'active',
): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `insert into accounts (organization_id, platform_id, display_name, created_by, status, archived_at)
     values ($1, (select id from platforms where slug = 'custom' and organization_id is null), $2, $3, $4,
             case when $4 = 'archived' then now() else null end)
     returning id`,
    [organizationId, name, createdBy, status],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function insertShare(
  organizationId: string,
  accountId: string,
  granteeType: 'user' | 'group',
  granteeId: string,
  level: string,
  grantedBy: string,
  expiresAtSql = 'null',
): Promise<void> {
  await db.admin.query(
    `insert into shares
       (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by, expires_at)
     values ($1, 'account', $2, $3, $4, $5, $6, ${expiresAtSql})`,
    [organizationId, accountId, granteeType, granteeId, level, grantedBy],
  );
}

async function seedOrganization(slug: string): Promise<SeededOrganization> {
  const organizationId = await db.seedOrganization(slug);
  const rootId = await insertUser(organizationId, 'root', 0, null);
  const leaverId = await insertUser(organizationId, 'leaver', 3, rootId);
  const colleagueId = await insertUser(organizationId, 'colleague', 3, rootId);
  const suspendedColleagueId = await insertUser(
    organizationId,
    'suspended',
    3,
    rootId,
    'suspended',
  );
  return { organizationId, rootId, leaverId, colleagueId, suspendedColleagueId };
}

function orphanedBy(org: SeededOrganization, leaverId: string): Promise<readonly string[]> {
  return requestContext.run(contextFor(org.organizationId), () =>
    uow.run(() => new PgOffboardingAccountStore(uow).lockAccountsOnlyManagedBy(asUserId(leaverId))),
  );
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  orgA = await seedOrganization('offboarding-store-a');
  orgB = await seedOrganization('offboarding-store-b');
});

afterAll(async () => {
  await db.close();
});

describe('OffboardingAccountStore.lockAccountsOnlyManagedBy against PostgreSQL', () => {
  it('returns the account the leaver alone manages', async () => {
    const accountId = await insertAccount(orgA.organizationId, orgA.rootId, 'solo');
    await insertShare(orgA.organizationId, accountId, 'user', orgA.leaverId, 'MANAGE', orgA.rootId);

    expect(await orphanedBy(orgA, orgA.leaverId)).toContain(accountId);
  });

  it('skips an account another active person also manages', async () => {
    const accountId = await insertAccount(orgA.organizationId, orgA.rootId, 'shared-manage');
    await insertShare(orgA.organizationId, accountId, 'user', orgA.leaverId, 'MANAGE', orgA.rootId);
    await insertShare(
      orgA.organizationId,
      accountId,
      'user',
      orgA.colleagueId,
      'MANAGE',
      orgA.rootId,
    );

    expect(await orphanedBy(orgA, orgA.leaverId)).not.toContain(accountId);
  });

  it('counts a suspended co-manager as no manager', async () => {
    const accountId = await insertAccount(orgA.organizationId, orgA.rootId, 'suspended-co');
    await insertShare(orgA.organizationId, accountId, 'user', orgA.leaverId, 'MANAGE', orgA.rootId);
    await insertShare(
      orgA.organizationId,
      accountId,
      'user',
      orgA.suspendedColleagueId,
      'MANAGE',
      orgA.rootId,
    );

    expect(await orphanedBy(orgA, orgA.leaverId)).toContain(accountId);
  });

  it('skips an account a group the leaver does not belong to manages through an active member', async () => {
    const accountId = await insertAccount(orgA.organizationId, orgA.rootId, 'group-managed');
    const group = await db.admin.query<{ id: string }>(
      `insert into groups (organization_id, name, created_by) values ($1, 'Gestores', $2) returning id`,
      [orgA.organizationId, orgA.rootId],
    );
    const groupId = group.rows[0]?.id ?? '';
    await db.admin.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       values ($1, $2, $3, 'member', $4)`,
      [orgA.organizationId, groupId, orgA.colleagueId, orgA.rootId],
    );
    await insertShare(orgA.organizationId, accountId, 'user', orgA.leaverId, 'MANAGE', orgA.rootId);
    await insertShare(orgA.organizationId, accountId, 'group', groupId, 'MANAGE', orgA.rootId);

    expect(await orphanedBy(orgA, orgA.leaverId)).not.toContain(accountId);
  });

  it('ignores accounts where the leaver only has a lower level, an expired share or the account is archived', async () => {
    const viewOnly = await insertAccount(orgA.organizationId, orgA.rootId, 'view-only');
    await insertShare(orgA.organizationId, viewOnly, 'user', orgA.leaverId, 'VIEW', orgA.rootId);
    const expired = await insertAccount(orgA.organizationId, orgA.rootId, 'expired');
    await insertShare(
      orgA.organizationId,
      expired,
      'user',
      orgA.leaverId,
      'MANAGE',
      orgA.rootId,
      "now() - interval '1 day'",
    );
    const archived = await insertAccount(orgA.organizationId, orgA.rootId, 'archived', 'archived');
    await insertShare(orgA.organizationId, archived, 'user', orgA.leaverId, 'MANAGE', orgA.rootId);

    const orphaned = await orphanedBy(orgA, orgA.leaverId);
    expect(orphaned).not.toContain(viewOnly);
    expect(orphaned).not.toContain(expired);
    expect(orphaned).not.toContain(archived);
  });

  it('returns the accounts ordered by id', async () => {
    const orphaned = await orphanedBy(orgA, orgA.leaverId);
    expect(orphaned.length).toBeGreaterThan(1);
    expect([...orphaned]).toEqual([...orphaned].sort());
  });

  it('never returns accounts of another organization', async () => {
    const foreignAccount = await insertAccount(orgB.organizationId, orgB.rootId, 'foreign');
    await insertShare(
      orgB.organizationId,
      foreignAccount,
      'user',
      orgB.leaverId,
      'MANAGE',
      orgB.rootId,
    );

    expect(await orphanedBy(orgA, orgB.leaverId)).toEqual([]);
    expect(await orphanedBy(orgA, orgA.leaverId)).not.toContain(foreignAccount);
  });
});

describe('OffboardingAccountStore.grantManagement against PostgreSQL', () => {
  function grant(org: SeededOrganization, accountId: string, granteeId: string) {
    return requestContext.run(contextFor(org.organizationId), () =>
      uow.run(() =>
        new PgOffboardingAccountStore(uow).grantManagement({
          accountId,
          granteeId: asUserId(granteeId),
          grantedBy: asUserId(org.rootId),
        }),
      ),
    );
  }

  async function liveShare(accountId: string, granteeId: string) {
    const result = await db.admin.query<{
      level: string;
      reason: string | null;
      expires_at: Date | null;
    }>(
      `select level, reason, expires_at from shares
        where resource_id = $1 and grantee_id = $2 and revoked_at is null`,
      [accountId, granteeId],
    );
    return result.rows;
  }

  it('inserts a MANAGE share with the offboarding reason when the person has none', async () => {
    const accountId = await insertAccount(orgA.organizationId, orgA.rootId, 'grant-insert');

    expect(await grant(orgA, accountId, orgA.colleagueId)).toBe('granted');
    expect(await liveShare(accountId, orgA.colleagueId)).toEqual([
      { level: 'MANAGE', reason: 'offboarding', expires_at: null },
    ]);
  });

  it('upgrades the live share and clears its expiry instead of colliding with the unique index', async () => {
    const accountId = await insertAccount(orgA.organizationId, orgA.rootId, 'grant-upgrade');
    await insertShare(
      orgA.organizationId,
      accountId,
      'user',
      orgA.colleagueId,
      'VIEW',
      orgA.rootId,
      "now() - interval '1 day'",
    );

    expect(await grant(orgA, accountId, orgA.colleagueId)).toBe('upgraded');
    expect(await liveShare(accountId, orgA.colleagueId)).toEqual([
      { level: 'MANAGE', reason: 'offboarding', expires_at: null },
    ]);
  });

  it('cannot grant on an account of another organization', async () => {
    const foreignAccount = await insertAccount(orgB.organizationId, orgB.rootId, 'grant-foreign');

    await expect(grant(orgA, foreignAccount, orgA.colleagueId)).rejects.toThrow();
    expect(await liveShare(foreignAccount, orgA.colleagueId)).toEqual([]);
  });
});
