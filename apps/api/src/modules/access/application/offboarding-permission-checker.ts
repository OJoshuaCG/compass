import type { Permission } from '@iam/contracts';

import type { CandidatePermissionChecker } from '../../directory/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import { effectivePermissions } from '../domain/effective-permissions.js';
import type { RoleRepository } from './ports/role-repository.js';

/**
 * Permisos que debe tener, sin que se le otorguen, quien recibe una cuenta al darse de baja a su único
 * responsable: poder compartirla, editar sus credenciales y gestionar su rotación (governance §2.4).
 */
const PERMISSIONS_REQUIRED_TO_RECEIVE_ACCOUNT: readonly Permission[] = [
  'share.manage',
  'credential.update',
  'rotation.manage',
];

export class OffboardingPermissionChecker implements CandidatePermissionChecker {
  constructor(private readonly roles: RoleRepository) {}

  async hasRequiredPermissions(candidate: {
    readonly id: UserId;
    readonly rank: Rank;
  }): Promise<boolean> {
    const granted = effectivePermissions(
      await this.roles.rolePermissionsOf(candidate.id),
      candidate.rank,
    );
    return PERMISSIONS_REQUIRED_TO_RECEIVE_ACCOUNT.every((permission) => granted.has(permission));
  }
}
