// SENSIBLE (revisión humana): baja de una persona en la bóveda; ruta protegida (acceso y rotación).
import { describe, expect, it } from 'vitest';

import { RANK, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import type { UserRecord, UserStatus } from '../domain/user.js';
import { InMemoryOffboardingAccountStore } from '../testing/in-memory-offboarding-account-store.js';
import {
  InMemoryOffboardingAccessCleanup,
  InMemoryOffboardingRotationStore,
} from '../testing/in-memory-offboarding-cleanup-and-rotation.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { OffboardAccounts } from './offboard-accounts.js';
import type { CandidatePermissionChecker } from './ports/candidate-permission-checker.js';
import { ReassignOffboardedAccounts } from './reassign-offboarded-accounts.js';

const ROOT_ID = asUserId('root');
const ADMIN_ID = asUserId('admin');
const LEADER_ID = asUserId('leader');
const OPERATOR_ID = asUserId('operator');
const NOW = new Date('2026-11-04T12:00:00.000Z');
const SEVENTY_TWO_HOURS_LATER = new Date('2026-11-07T12:00:00.000Z');

function person(
  id: UserId,
  rank: Rank,
  managedBy: UserId | null,
  status: UserStatus = 'active',
): UserRecord {
  return {
    id,
    organizationId: asOrganizationId('org-1'),
    rank,
    status,
    email: `${id}@example.test`,
    displayName: id,
    managedBy,
    createdBy: managedBy,
    locale: 'es-MX',
    timezone: 'America/Mexico_City',
  };
}

function setup(options: {
  readonly withPermissions: readonly UserId[];
  readonly rootStatus?: UserStatus;
}) {
  const directory = new InMemoryUserDirectory();
  directory.add(person(ROOT_ID, RANK.ROOT, null, options.rootStatus ?? 'active'));
  directory.add(person(ADMIN_ID, RANK.ADMINISTRATOR, ROOT_ID));
  directory.add(person(LEADER_ID, RANK.LEADER, ADMIN_ID));
  directory.add(person(OPERATOR_ID, RANK.OPERATOR, LEADER_ID));

  const accounts = new InMemoryOffboardingAccountStore();
  const cleanup = new InMemoryOffboardingAccessCleanup();
  const rotation = new InMemoryOffboardingRotationStore();
  const permissions: CandidatePermissionChecker = {
    hasRequiredPermissions: ({ id }) => Promise.resolve(options.withPermissions.includes(id)),
  };
  const reassignment = new ReassignOffboardedAccounts({ directory, accounts, permissions });
  return {
    accounts,
    cleanup,
    rotation,
    useCase: new OffboardAccounts({ reassignment, cleanup, rotation, clock: { now: () => NOW } }),
  };
}

describe('OffboardAccounts', () => {
  it('reads the exposure before revoking, then revokes shares and removes the groups', async () => {
    const { useCase, cleanup } = setup({ withPermissions: [LEADER_ID] });
    cleanup.exposedAccounts = ['a1', 'a2'];
    cleanup.revokedShares = 3;
    cleanup.removedGroups = 2;

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(cleanup.calls).toEqual(['list', 'revoke', 'groups']);
    expect(report.exposedAccountCount).toBe(2);
    expect(report.revokedShareCount).toBe(3);
    expect(report.removedGroupMembershipCount).toBe(2);
  });

  it('asks for rotation of every live credential within 72 hours, high priority for those revealed', async () => {
    const { useCase, cleanup, rotation } = setup({ withPermissions: [LEADER_ID] });
    cleanup.exposedAccounts = ['a1'];
    rotation.liveCredentials = [
      { credentialId: 'c1', accountId: 'a1' },
      { credentialId: 'c2', accountId: 'a1' },
      { credentialId: 'c-elsewhere', accountId: 'a-other' },
    ];
    rotation.revealedCredentialIds = ['c2'];

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.rotationTasksCreated).toBe(2);
    expect(rotation.createdTasks).toEqual([
      {
        credentialId: 'c1',
        triggeredBy: OPERATOR_ID,
        assignedTo: LEADER_ID,
        priority: 'normal',
        dueAt: SEVENTY_TWO_HOURS_LATER,
      },
      {
        credentialId: 'c2',
        triggeredBy: OPERATOR_ID,
        assignedTo: LEADER_ID,
        priority: 'high',
        dueAt: SEVENTY_TWO_HOURS_LATER,
      },
    ]);
  });

  it('gives the rotation to the active Root when nobody in the chain qualifies', async () => {
    const { useCase, cleanup, rotation } = setup({ withPermissions: [] });
    cleanup.exposedAccounts = ['a1'];
    rotation.liveCredentials = [{ credentialId: 'c1', accountId: 'a1' }];

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.rotationAssigneeId).toBe(ROOT_ID);
    expect(rotation.createdTasks.map((task) => task.assignedTo)).toEqual([ROOT_ID]);
  });

  it('fails instead of leaving credentials without an assignee when there is no active Root', async () => {
    const { useCase, cleanup, rotation } = setup({ withPermissions: [], rootStatus: 'suspended' });
    cleanup.exposedAccounts = ['a1'];
    rotation.liveCredentials = [{ credentialId: 'c1', accountId: 'a1' }];

    await expect(useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID })).rejects.toThrow(
      /active Root/,
    );
    expect(rotation.createdTasks).toEqual([]);
  });

  it('creates no rotation tasks and needs no assignee when the person had no live credentials', async () => {
    const { useCase, cleanup, rotation } = setup({ withPermissions: [], rootStatus: 'suspended' });
    cleanup.exposedAccounts = ['a1'];

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.rotationTasksCreated).toBe(0);
    expect(report.rotationAssigneeId).toBeNull();
    expect(rotation.createdTasks).toEqual([]);
  });

  it('reassigns the orphaned accounts and reports them next to the cleanup', async () => {
    const { useCase, accounts } = setup({ withPermissions: [LEADER_ID] });
    accounts.orphanedBy.set(OPERATOR_ID, ['a1']);

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.reassignment.reassigned.map((r) => [r.accountId, r.managerId])).toEqual([
      ['a1', LEADER_ID],
    ]);
    expect(accounts.grants).toHaveLength(1);
  });
});
