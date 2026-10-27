import type { Permission } from '@iam/contracts';

import type { Rank } from '../../../shared/kernel/index.js';
import { rankAllows } from './permission-catalog.js';

export type RoleAssignmentDenial = 'NOT_MANAGED' | 'ESCALATION' | 'CEILING';

/**
 * No escalamiento (plan, ADR 012): al asignar un rol a T, el actor debe gestionar a T, tener TODOS
 * los permisos del rol, y ningún permiso del rol puede superar el techo del rango de T.
 */
export function checkRoleAssignment(input: {
  readonly actorManagesTarget: boolean;
  readonly actorPermissions: ReadonlySet<Permission>;
  readonly rolePermissions: readonly Permission[];
  readonly targetRank: Rank;
}): RoleAssignmentDenial | null {
  if (!input.actorManagesTarget) return 'NOT_MANAGED';
  if (input.rolePermissions.some((permission) => !input.actorPermissions.has(permission))) {
    return 'ESCALATION';
  }
  if (input.rolePermissions.some((permission) => !rankAllows(permission, input.targetRank))) {
    return 'CEILING';
  }
  return null;
}

/** Un rol personalizado solo puede contener permisos que su creador tiene (subconjunto). */
export function isSubsetOfCreator(
  rolePermissions: readonly Permission[],
  creatorPermissions: ReadonlySet<Permission>,
): boolean {
  return rolePermissions.every((permission) => creatorPermissions.has(permission));
}
