/**
 * SENSIBLE (ruta protegida: acceso a la bóveda y rotación). Esta prueba la debe revisar una persona.
 *
 * Cubre contra PostgreSQL real lo que la baja le quita a la persona (comparticiones directas y grupos) y las
 * tareas de rotación que exige.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  PgOffboardingAccessCleanup,
  PgOffboardingRotationStore,
} from '../src/modules/vault/index.js';
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
  readonly otherId: string;
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
): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, managed_by)
     values ($1, $2, $3, $4, $5) returning id`,
    [organizationId, `${label}@${organizationId}.test`, label, rank, managedBy],
  );
  return result.rows[0]?.id ?? '';
}

async function seedOrganization(slug: string): Promise<SeededOrganization> {
  const organizationId = await db.seedOrganization(slug);
  const rootId = await insertUser(organizationId, 'root', 0, null);
  const leaverId = await insertUser(organizationId, 'leaver', 3, rootId);
  const otherId = await insertUser(organizationId, 'other', 3, rootId);
  return { organizationId, rootId, leaverId, otherId };
}

async function insertAccount(org: SeededOrganization, name: string, archived = false) {
  const result = await db.admin.query<{ id: string }>(
    `insert into accounts (organization_id, platform_id, display_name, created_by, status, archived_at)
     values ($1, (select id from platforms where slug = 'custom' and organization_id is null), $2, $3, $4,
             case when $5 then now() else null end)
     returning id`,
    [org.organizationId, name, org.rootId, archived ? 'archived' : 'active', archived],
  );
  return result.rows[0]?.id ?? '';
}

async function insertShare(
  org: SeededOrganization,
  accountId: string,
  granteeType: 'user' | 'group',
  granteeId: string,
  level: string,
) {
  await db.admin.query(
    `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
     values ($1, 'account', $2, $3, $4, $5, $6)`,
    [org.organizationId, accountId, granteeType, granteeId, level, org.rootId],
  );
}

async function insertCredential(org: SeededOrganization, accountId: string, archived = false) {
  const result = await db.admin.query<{ id: string }>(
    `insert into credentials (organization_id, account_id, label, kind, created_by, archived_at)
     values ($1, $2, 'cred', 'password', $3, case when $4 then now() else null end) returning id`,
    [org.organizationId, accountId, org.rootId, archived],
  );
  return result.rows[0]?.id ?? '';
}

async function insertGroupWithMember(org: SeededOrganization, name: string, memberId: string) {
  const group = await db.admin.query<{ id: string }>(
    `insert into groups (organization_id, name, created_by) values ($1, $2, $3) returning id`,
    [org.organizationId, name, org.rootId],
  );
  const groupId = group.rows[0]?.id ?? '';
  await db.admin.query(
    `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
     values ($1, $2, $3, 'member', $4)`,
    [org.organizationId, groupId, memberId, org.rootId],
  );
  return groupId;
}

function inOrg<T>(org: SeededOrganization, work: () => Promise<T>): Promise<T> {
  return requestContext.run(contextFor(org.organizationId), () => uow.run(work));
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  orgA = await seedOrganization('offboarding-cleanup-a');
  orgB = await seedOrganization('offboarding-cleanup-b');
});

afterAll(async () => {
  await db.close();
});

describe('OffboardingAccessCleanup against PostgreSQL', () => {
  it('lists the accounts with view or more access, direct or by group, and skips USE and archived', async () => {
    const viewed = await insertAccount(orgA, 'viewed');
    const managedByGroup = await insertAccount(orgA, 'by-group');
    const useOnly = await insertAccount(orgA, 'use-only');
    const archived = await insertAccount(orgA, 'archived', true);
    await insertShare(orgA, viewed, 'user', orgA.leaverId, 'VIEW');
    await insertShare(orgA, useOnly, 'user', orgA.leaverId, 'USE');
    await insertShare(orgA, archived, 'user', orgA.leaverId, 'MANAGE');
    const groupId = await insertGroupWithMember(orgA, 'Equipo', orgA.leaverId);
    await insertShare(orgA, managedByGroup, 'group', groupId, 'EDIT');

    const listed = await inOrg(orgA, () =>
      new PgOffboardingAccessCleanup(uow).listAccountsWithViewOrMoreAccess(asUserId(orgA.leaverId)),
    );

    expect(listed).toContain(viewed);
    expect(listed).toContain(managedByGroup);
    expect(listed).not.toContain(useOnly);
    expect(listed).not.toContain(archived);
  });

  it('revokes only the direct shares of the person, keeping the trace and the shares they granted', async () => {
    const own = await insertAccount(orgA, 'own-share');
    const grantedByLeaver = await insertAccount(orgA, 'granted-by-leaver');
    await insertShare(orgA, own, 'user', orgA.leaverId, 'MANAGE');
    await db.admin.query(
      `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'account', $2, 'user', $3, 'VIEW', $4)`,
      [orgA.organizationId, grantedByLeaver, orgA.otherId, orgA.leaverId],
    );

    const revoked = await inOrg(orgA, () =>
      new PgOffboardingAccessCleanup(uow).revokeDirectShares({
        userId: asUserId(orgA.leaverId),
        revokedBy: asUserId(orgA.rootId),
      }),
    );

    expect(revoked).toBeGreaterThanOrEqual(1);
    const rows = await db.admin.query<{ revoked_at: Date | null; revoked_by: string | null }>(
      `select revoked_at, revoked_by from shares where resource_id = $1 and grantee_id = $2`,
      [own, orgA.leaverId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.revoked_at).not.toBeNull();
    expect(rows.rows[0]?.revoked_by).toBe(orgA.rootId);
    const kept = await db.admin.query(
      `select 1 from shares where resource_id = $1 and grantee_id = $2 and revoked_at is null`,
      [grantedByLeaver, orgA.otherId],
    );
    expect(kept.rows).toHaveLength(1);
  });

  it('removes the person from every group and leaves the other members', async () => {
    const groupId = await insertGroupWithMember(orgA, 'Soporte', orgA.leaverId);
    await db.admin.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       values ($1, $2, $3, 'member', $4)`,
      [orgA.organizationId, groupId, orgA.otherId, orgA.rootId],
    );

    const removed = await inOrg(orgA, () =>
      new PgOffboardingAccessCleanup(uow).removeFromAllGroups(asUserId(orgA.leaverId)),
    );

    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await db.admin.query<{ user_id: string }>(
      'select user_id from group_memberships where group_id = $1',
      [groupId],
    );
    expect(left.rows.map((row) => row.user_id)).toEqual([orgA.otherId]);
  });

  it('never touches the shares or groups of another organization', async () => {
    const accountB = await insertAccount(orgB, 'foreign');
    await insertShare(orgB, accountB, 'user', orgB.leaverId, 'MANAGE');

    await inOrg(orgA, async () => {
      const cleanup = new PgOffboardingAccessCleanup(uow);
      await cleanup.revokeDirectShares({
        userId: asUserId(orgB.leaverId),
        revokedBy: asUserId(orgA.rootId),
      });
    });

    const alive = await db.admin.query(
      'select 1 from shares where resource_id = $1 and revoked_at is null',
      [accountB],
    );
    expect(alive.rows).toHaveLength(1);
  });
});

describe('OffboardingRotationStore against PostgreSQL', () => {
  it('lists only live credentials of the given accounts', async () => {
    const account = await insertAccount(orgA, 'with-creds');
    const live = await insertCredential(orgA, account);
    const archived = await insertCredential(orgA, account, true);
    const otherAccount = await insertAccount(orgA, 'other-creds');
    await insertCredential(orgA, otherAccount);

    const listed = await inOrg(orgA, () =>
      new PgOffboardingRotationStore(uow).listLiveCredentials([account]),
    );

    expect(listed).toEqual([{ credentialId: live, accountId: account }]);
    expect(listed.map((item) => item.credentialId)).not.toContain(archived);
  });

  it('reports as revealed only the credentials the person revealed successfully', async () => {
    const account = await insertAccount(orgA, 'reveal');
    const revealed = await insertCredential(orgA, account);
    const deniedOnly = await insertCredential(orgA, account);
    const revealedByOther = await insertCredential(orgA, account);
    const neverRevealed = await insertCredential(orgA, account);
    const record = (actor: string, target: string, outcome: string) =>
      db.admin.query(
        `insert into audit_events (organization_id, actor_id, action, target_type, target_id, outcome)
         values ($1, $2, 'credential.revealed', 'credential', $3, $4)`,
        [orgA.organizationId, actor, target, outcome],
      );
    await record(orgA.leaverId, revealed, 'success');
    await record(orgA.leaverId, deniedOnly, 'denied');
    await record(orgA.otherId, revealedByOther, 'success');

    const result = await inOrg(orgA, () =>
      new PgOffboardingRotationStore(uow).listRevealedCredentialIds({
        userId: orgA.leaverId,
        credentialIds: [revealed, deniedOnly, revealedByOther, neverRevealed],
      }),
    );

    expect(result).toEqual([revealed]);
  });

  it('creates one user_deactivated task per credential and does not duplicate an open one', async () => {
    const account = await insertAccount(orgA, 'tasks');
    const first = await insertCredential(orgA, account);
    const second = await insertCredential(orgA, account);
    const dueAt = new Date('2030-01-04T00:00:00.000Z');
    const task = (credentialId: string, priority: 'high' | 'normal') => ({
      credentialId,
      triggeredBy: orgA.leaverId,
      assignedTo: orgA.rootId,
      priority,
      dueAt,
    });

    const firstRun = await inOrg(orgA, () =>
      new PgOffboardingRotationStore(uow).createTasks([
        task(first, 'high'),
        task(second, 'normal'),
      ]),
    );
    const secondRun = await inOrg(orgA, () =>
      new PgOffboardingRotationStore(uow).createTasks([task(first, 'high')]),
    );

    expect(firstRun).toBe(2);
    expect(secondRun).toBe(0);
    const stored = await db.admin.query<{
      credential_id: string;
      trigger: string;
      priority: string;
      assigned_to: string;
      triggered_by_user: string;
    }>(
      `select credential_id, trigger, priority, assigned_to, triggered_by_user
         from rotation_tasks where credential_id = any($1::uuid[]) order by priority`,
      [[first, second]],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every((row) => row.trigger === 'user_deactivated')).toBe(true);
    expect(stored.rows.every((row) => row.assigned_to === orgA.rootId)).toBe(true);
    expect(stored.rows.every((row) => row.triggered_by_user === orgA.leaverId)).toBe(true);
    expect(stored.rows.map((row) => row.priority)).toEqual(['high', 'normal']);
  });

  it('cannot create a task for a credential of another organization', async () => {
    const accountB = await insertAccount(orgB, 'foreign-tasks');
    const credentialB = await insertCredential(orgB, accountB);

    await expect(
      inOrg(orgA, () =>
        new PgOffboardingRotationStore(uow).createTasks([
          {
            credentialId: credentialB,
            triggeredBy: orgA.leaverId,
            assignedTo: orgA.rootId,
            priority: 'high',
            dueAt: new Date('2030-01-04T00:00:00.000Z'),
          },
        ]),
      ),
    ).rejects.toThrow();
  });
});
