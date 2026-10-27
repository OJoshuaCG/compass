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
  /** Roles vigentes (no archivados), plantillas del sistema primero. */
  listLive(): Promise<readonly RoleRecord[]>;
  /** `name_taken` si ya hay un rol vigente con ese nombre (sin distinguir mayúsculas). */
  insertCustom(input: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
    readonly createdBy: UserId;
  }): Promise<'inserted' | 'name_taken'>;
  findLiveById(id: string): Promise<RoleRecord | null>;
  archive(id: string, at: Date): Promise<void>;
  assign(userId: UserId, roleId: string, grantedBy: UserId): Promise<void>;
}
