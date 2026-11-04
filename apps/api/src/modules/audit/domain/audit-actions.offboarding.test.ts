// SENSIBLE (revisión humana): lista blanca de la auditoría; ruta protegida.
import { describe, expect, it } from 'vitest';

import { sanitizeMetadata } from './audit-actions.js';

describe('audit metadata allowlist for offboarding', () => {
  it('accepts the documented counters of user.deactivated', () => {
    const counters = {
      rotationTasks: 4,
      reassignedReports: 1,
      exposedAccounts: 6,
      reassignedAccounts: 2,
      unassignedAccounts: 1,
      revokedShares: 3,
      removedGroups: 2,
    };
    expect(sanitizeMetadata('user.deactivated', counters)).toEqual(counters);
  });

  it('accepts the documented fields of the per-account offboarding actions', () => {
    const reassigned = {
      leaverId: 'u1',
      receiverId: 'u2',
      reason: 'branch',
      notified: false,
      grant: 'granted',
    };
    expect(sanitizeMetadata('account.offboarding_reassigned', reassigned)).toEqual(reassigned);
    expect(sanitizeMetadata('account.offboarding_unassigned', { leaverId: 'u1' })).toEqual({
      leaverId: 'u1',
    });
  });

  it.each([
    ['user.deactivated', 'accountName'],
    ['account.offboarding_reassigned', 'password'],
    ['account.offboarding_unassigned', 'receiverId'],
  ])('rejects a field outside the list of %s (%s)', (action, field) => {
    expect(() => sanitizeMetadata(action, { [field]: 'x' })).toThrow();
  });
});
