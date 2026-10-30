import type { Rank, UserId } from '../../../../shared/kernel/index.js';

/** Rol tal como lo necesita el resultado de un cambio de rango: identificador y nombre visible. */
export interface RoleSummary {
  readonly id: string;
  readonly name: string;
}

/** Lo que cambió en los roles de una persona al ajustarse a su nuevo rango. */
export interface RoleAdjustment {
  readonly removedRoles: readonly RoleSummary[];
  /** Plantilla del nuevo rango, solo si el recorte dejó a la persona sin ningún rol vigente. */
  readonly assignedRole: RoleSummary | null;
}

/**
 * Ajusta los roles de una persona cuando baja de rango. La implementación vive en el módulo de
 * acceso (dueño de los roles y de los techos por rango); `directory` define el puerto para no
 * importarlo, igual que con `SessionRevoker`.
 *
 * Corre en la transacción del cambio de rango: si algo falla, ni el rango ni los roles cambian.
 */
export interface AssignedRoleRevoker {
  /**
   * Quita de forma persistente los roles vigentes de `userId` que contengan algún permiso por encima
   * del techo de `newRank`. Si la persona se queda sin ningún rol vigente, le asigna la plantilla de
   * rol del sistema de `newRank` (igual que al aceptar una invitación), otorgada por `grantedBy`.
   */
  revokeRolesAboveRank(input: {
    readonly userId: UserId;
    readonly newRank: Rank;
    readonly grantedBy: UserId;
  }): Promise<RoleAdjustment>;
}
