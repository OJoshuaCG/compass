import type { Permission } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';

export interface RoleRecord {
  readonly id: string;
  readonly name: string;
  readonly isSystem: boolean;
  readonly permissions: readonly Permission[];
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface RoleRepository {
  /** Permisos de los roles vigentes (no archivados) asignados a un usuario. */
  rolePermissionsOf(userId: UserId): Promise<readonly (readonly Permission[])[]>;
  findByIds(ids: readonly string[]): Promise<readonly RoleRecord[]>;
  findSystemRole(name: string): Promise<RoleRecord | null>;
  assign(userId: UserId, roleId: string, grantedBy: UserId): Promise<void>;
}
