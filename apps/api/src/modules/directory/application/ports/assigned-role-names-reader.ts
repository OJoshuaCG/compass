import type { UserId } from '../../../../shared/kernel/index.js';

/**
 * Nombres de los roles vigentes de varias personas, para la vista de gestión. La implementación vive
 * en el módulo de acceso (dueño de los roles); `directory` define el puerto para no importarlo,
 * igual que con `AssignedRoleRevoker`.
 *
 * Corre en la transacción en curso, con la organización fijada por RLS. No decide permisos: quien lo
 * llama ya resolvió a quién se le pueden mostrar los roles.
 */
export interface AssignedRoleNamesReader {
  /**
   * Para cada persona de `userIds`, los nombres de sus roles vigentes (no archivados), sin el rol
   * personal. Una persona sin roles aparece con una lista vacía. Una sola consulta para todo el lote.
   */
  listLiveRoleNames(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, readonly string[]>>;
}
