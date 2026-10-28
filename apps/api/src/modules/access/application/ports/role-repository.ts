import type { Permission } from '@iam/contracts';

import type { KeysetPage, KeysetRequest, UserId } from '../../../../shared/kernel/index.js';

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
  /** Una página de los roles vigentes (no archivados): plantillas del sistema primero, luego por nombre. */
  listLivePage(page: KeysetRequest): Promise<KeysetPage<RoleRecord>>;
  /** `name_taken` si ya hay un rol vigente con ese nombre (sin distinguir mayúsculas). */
  insertCustom(input: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
    readonly createdBy: UserId;
  }): Promise<'inserted' | 'name_taken'>;
  /**
   * Reemplaza nombre y permisos de un rol personalizado vigente. `name_taken` si otro vigente ya usa el
   * nombre; `not_found` si ya no hay un rol personalizado vigente con ese id (p. ej. se archivó antes).
   */
  updateCustom(input: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
  }): Promise<'updated' | 'name_taken' | 'not_found'>;
  findLiveById(id: string): Promise<RoleRecord | null>;
  /**
   * Como `findLiveById`, pero bloquea la fila hasta el fin de la transacción: la edición decide sobre los
   * permisos actuales y nadie puede archivarlos ni cambiarlos entre la comprobación y la escritura.
   */
  findLiveByIdForUpdate(id: string): Promise<RoleRecord | null>;
  archive(id: string, at: Date): Promise<void>;
  assign(userId: UserId, roleId: string, grantedBy: UserId): Promise<void>;
}
