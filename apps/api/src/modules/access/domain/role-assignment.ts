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

/**
 * Roles que dejan de ser válidos al pasar a `newRank`: los que contienen algún permiso cuyo techo de
 * rango queda por debajo. Se quita el rol completo (no se recorta): un rol es la unidad que se
 * asigna y se audita, y editarlo cambiaría a las demás personas que lo tienen.
 */
export function rolesExceedingRank<T extends { readonly permissions: readonly Permission[] }>(
  roles: readonly T[],
  newRank: Rank,
): T[] {
  return roles.filter((role) =>
    role.permissions.some((permission) => !rankAllows(permission, newRank)),
  );
}

/** Un rol personalizado solo puede contener permisos que su creador tiene (subconjunto). */
export function isSubsetOfCreator(
  rolePermissions: readonly Permission[],
  creatorPermissions: ReadonlySet<Permission>,
): boolean {
  return rolePermissions.every((permission) => creatorPermissions.has(permission));
}
