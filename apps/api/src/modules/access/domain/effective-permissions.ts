import type { Permission } from '@iam/contracts';

import type { Rank } from '../../../shared/kernel/index.js';
import { rankAllows } from './permission-catalog.js';

/**
 * Permisos efectivos de un usuario: unión de los de todos sus roles, recortada por el techo de su
 * rango. El recorte se recalcula siempre desde el rango actual, así que cambiar el rango de alguien
 * no deja permisos "heredados" de un rango anterior.
 */
export function effectivePermissions(
  rolePermissions: readonly (readonly Permission[])[],
  rank: Rank,
): ReadonlySet<Permission> {
  const union = new Set<Permission>();
  for (const permissions of rolePermissions) {
    for (const permission of permissions) {
      if (rankAllows(permission, rank)) union.add(permission);
    }
  }
  return union;
}
