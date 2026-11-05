// SENSIBLE (revisión humana): reasignación de cuentas en una baja; ruta protegida (acceso a la bóveda).
import { describe, expect, it } from 'vitest';

import { RANK, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import type { UserRecord, UserStatus } from '../domain/user.js';
import { InMemoryOffboardingAccountStore } from '../testing/in-memory-offboarding-account-store.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import type { CandidatePermissionChecker } from './ports/candidate-permission-checker.js';
import { ReassignOffboardedAccounts } from './reassign-offboarded-accounts.js';

const ROOT_ID = asUserId('root');
const ADMIN_ID = asUserId('admin');
const LEADER_ID = asUserId('leader');
const OPERATOR_ID = asUserId('operator');
const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

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

/** Raíz > Administrador > Líder > Operador (quien se va). */
function setup(options: {
  readonly withPermissions: readonly UserId[];
  readonly leaderStatus?: UserStatus;
  readonly orphanedAccounts?: readonly string[];
}) {
  const directory = new InMemoryUserDirectory();
  directory.add(person(ROOT_ID, RANK.ROOT, null));
  directory.add(person(ADMIN_ID, RANK.ADMINISTRATOR, ROOT_ID));
  directory.add(person(LEADER_ID, RANK.LEADER, ADMIN_ID, options.leaderStatus ?? 'active'));
  directory.add(person(OPERATOR_ID, RANK.OPERATOR, LEADER_ID));

  const accounts = new InMemoryOffboardingAccountStore();
  accounts.orphanedBy.set(OPERATOR_ID, options.orphanedAccounts ?? [ACCOUNT_A, ACCOUNT_B]);

  const permissionLookups: UserId[] = [];
  const permissions: CandidatePermissionChecker = {
    hasRequiredPermissions: ({ id }) => {
      permissionLookups.push(id);
      return Promise.resolve(options.withPermissions.includes(id));
    },
  };
  return {
    accounts,
    permissionLookups,
    useCase: new ReassignOffboardedAccounts({ directory, accounts, permissions }),
  };
}

describe('ReassignOffboardedAccounts', () => {
  it('gives every orphaned account to the nearest qualifying superior in the actor branch, without notice', async () => {
    const { useCase, accounts } = setup({ withPermissions: [LEADER_ID, ADMIN_ID] });

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.unassignedAccountIds).toEqual([]);
    expect(report.reassigned).toEqual([
      {
        accountId: ACCOUNT_A,
        managerId: LEADER_ID,
        reason: 'branch',
        notify: false,
        grant: 'granted',
      },
      {
        accountId: ACCOUNT_B,
        managerId: LEADER_ID,
        reason: 'branch',
        notify: false,
        grant: 'granted',
      },
    ]);
    expect(accounts.grants.map((grant) => grant.grantedBy)).toEqual([ADMIN_ID, ADMIN_ID]);
  });

  it('falls back to the nearest Administrator outside the branch and asks for a notice', async () => {
    // Quien da la baja es el Líder, que no tiene los permisos: el Administrador queda fuera de su rama.
    const { useCase } = setup({ withPermissions: [ADMIN_ID, ROOT_ID] });

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: LEADER_ID });

    expect(report.reassigned.map((r) => [r.managerId, r.reason, r.notify])).toEqual([
      [ADMIN_ID, 'nearest_administrator', true],
      [ADMIN_ID, 'nearest_administrator', true],
    ]);
  });

  it('leaves the accounts unassigned and grants nothing when nobody qualifies', async () => {
    const { useCase, accounts } = setup({ withPermissions: [] });

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.reassigned).toEqual([]);
    expect(report.unassignedAccountIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(accounts.grants).toEqual([]);
  });

  it('skips an inactive superior without asking for its permissions', async () => {
    const { useCase, permissionLookups } = setup({
      withPermissions: [LEADER_ID, ADMIN_ID],
      leaderStatus: 'suspended',
    });

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.reassigned.every((r) => r.managerId === ADMIN_ID)).toBe(true);
    expect(permissionLookups).not.toContain(LEADER_ID);
  });

  it('treats nobody as inside the branch when the actor is not in the chain', async () => {
    const { useCase } = setup({ withPermissions: [LEADER_ID, ADMIN_ID] });

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: asUserId('stranger') });

    // El Líder califica pero no es Administrador y no está en la rama: se pasa al Administrador, con aviso.
    expect(report.reassigned.map((r) => [r.managerId, r.reason, r.notify])).toEqual([
      [ADMIN_ID, 'nearest_administrator', true],
      [ADMIN_ID, 'nearest_administrator', true],
    ]);
  });

  it('reports an upgraded share when the receiver already had access to the account', async () => {
    const { useCase, accounts } = setup({ withPermissions: [LEADER_ID] });
    accounts.alreadyShared.add(`${ACCOUNT_A}:${LEADER_ID}`);

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report.reassigned.map((r) => [r.accountId, r.grant])).toEqual([
      [ACCOUNT_A, 'upgraded'],
      [ACCOUNT_B, 'granted'],
    ]);
  });

  it('does nothing, not even reading the chain or permissions, when no account is orphaned', async () => {
    const { useCase, accounts, permissionLookups } = setup({
      withPermissions: [LEADER_ID],
      orphanedAccounts: [],
    });

    const report = await useCase.run({ leaverId: OPERATOR_ID, actorId: ADMIN_ID });

    expect(report).toEqual({ reassigned: [], unassignedAccountIds: [] });
    expect(accounts.grants).toEqual([]);
    expect(permissionLookups).toEqual([]);
  });
});
