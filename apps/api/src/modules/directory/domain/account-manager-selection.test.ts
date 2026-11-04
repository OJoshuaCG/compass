// SENSIBLE (revisión humana): regla de reasignación de cuentas en una baja; ruta protegida.
import { describe, expect, it } from 'vitest';

import { asUserId } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';
import { selectAccountManager } from './account-manager-selection.js';
import type { ManagerCandidate } from './account-manager-selection.js';
import type { UserStatus } from './user.js';

function candidate(
  label: string,
  rank: Rank,
  overrides: Partial<Pick<ManagerCandidate, 'inActorBranch' | 'hasRequiredPermissions'>> & {
    status?: UserStatus;
  } = {},
): ManagerCandidate {
  return {
    id: asUserId(label),
    rank,
    status: overrides.status ?? 'active',
    inActorBranch: overrides.inActorBranch ?? true,
    hasRequiredPermissions: overrides.hasRequiredPermissions ?? true,
  };
}

describe('selectAccountManager', () => {
  it('gives the account to the nearest qualifying superior inside the branch, without notifying', () => {
    const selection = selectAccountManager([
      candidate('leader', 2),
      candidate('admin', 1),
      candidate('root', 0),
    ]);

    expect(selection).toEqual({
      outcome: 'assigned',
      managerId: asUserId('leader'),
      reason: 'branch',
      notify: false,
    });
  });

  it('climbs past a superior who lacks the required permissions', () => {
    const selection = selectAccountManager([
      candidate('leader', 2, { hasRequiredPermissions: false }),
      candidate('admin', 1),
    ]);

    expect(selection).toMatchObject({ outcome: 'assigned', managerId: asUserId('admin') });
  });

  it.each<UserStatus>(['suspended', 'invited', 'deactivated'])(
    'never picks a superior who is %s',
    (status) => {
      const selection = selectAccountManager([
        candidate('leader', 2, { status }),
        candidate('admin', 1),
      ]);

      expect(selection).toMatchObject({ outcome: 'assigned', managerId: asUserId('admin') });
    },
  );

  it('falls back to the nearest Administrator outside the branch and notifies them', () => {
    const selection = selectAccountManager([
      candidate('leader', 2, { inActorBranch: false }),
      candidate('admin-near', 1, { inActorBranch: false }),
      candidate('admin-far', 1, { inActorBranch: false }),
      candidate('root', 0, { inActorBranch: false }),
    ]);

    expect(selection).toEqual({
      outcome: 'assigned',
      managerId: asUserId('admin-near'),
      reason: 'nearest_administrator',
      notify: true,
    });
  });

  it('does not use a qualifying non-Administrator outside the branch as a fallback', () => {
    const selection = selectAccountManager([
      candidate('leader', 2, { inActorBranch: false }),
      candidate('root', 0, { inActorBranch: false }),
    ]);

    expect(selection).toEqual({ outcome: 'unassigned' });
  });

  it('prefers a qualifying person inside the branch over a nearer Administrator outside it', () => {
    const selection = selectAccountManager([
      candidate('admin-outside', 1, { inActorBranch: false }),
      candidate('leader-inside', 2),
    ]);

    expect(selection).toMatchObject({ managerId: asUserId('leader-inside'), reason: 'branch' });
  });

  it('leaves the account unassigned when nobody qualifies', () => {
    const selection = selectAccountManager([
      candidate('admin', 1, { hasRequiredPermissions: false }),
      candidate('root', 0, { status: 'suspended' }),
    ]);

    expect(selection).toEqual({ outcome: 'unassigned' });
  });

  it('leaves the account unassigned for an empty chain', () => {
    expect(selectAccountManager([])).toEqual({ outcome: 'unassigned' });
  });
});
