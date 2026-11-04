/**
 * SENSIBLE (ruta protegida: acceso). Esta prueba la debe revisar una persona.
 */
import type { Permission } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { asUserId, RANK } from '../../../shared/kernel/index.js';
import { InMemoryRoleRepository } from '../testing/in-memory-role-repository.js';
import { OffboardingPermissionChecker } from './offboarding-permission-checker.js';

const CANDIDATE_ID = asUserId('0198cccc-0000-7000-8000-0000000000a1');

function setup(rolePermissions: readonly (readonly Permission[])[]) {
  const roles = new InMemoryRoleRepository();
  rolePermissions.forEach((permissions, index) => {
    const roleId = `role-${String(index)}`;
    roles.addRole({ id: roleId, name: roleId, isSystem: false, permissions });
    roles.grant(CANDIDATE_ID, roleId);
  });
  return new OffboardingPermissionChecker(roles);
}

describe('OffboardingPermissionChecker', () => {
  it('accepts a candidate who holds the three permissions, even spread over several roles', async () => {
    const checker = setup([['share.manage'], ['credential.update', 'rotation.manage']]);
    await expect(
      checker.hasRequiredPermissions({ id: CANDIDATE_ID, rank: RANK.LEADER }),
    ).resolves.toBe(true);
  });

  it.each<Permission>(['share.manage', 'credential.update', 'rotation.manage'])(
    'rejects a candidate who lacks %s',
    async (missing) => {
      const all: Permission[] = ['share.manage', 'credential.update', 'rotation.manage'];
      const checker = setup([all.filter((permission) => permission !== missing)]);
      await expect(
        checker.hasRequiredPermissions({ id: CANDIDATE_ID, rank: RANK.LEADER }),
      ).resolves.toBe(false);
    },
  );

  it('rejects an Operator whose role names rotation.manage, because the rank ceiling cuts it', async () => {
    const checker = setup([['share.manage', 'credential.update', 'rotation.manage']]);
    await expect(
      checker.hasRequiredPermissions({ id: CANDIDATE_ID, rank: RANK.OPERATOR }),
    ).resolves.toBe(false);
  });

  it('rejects a candidate without roles', async () => {
    const checker = setup([]);
    await expect(
      checker.hasRequiredPermissions({ id: CANDIDATE_ID, rank: RANK.ROOT }),
    ).resolves.toBe(false);
  });
});
