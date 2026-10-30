import type { Permission } from '@iam/contracts';

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
  /**
   * La persona se quedó sin rol y NO se le asignó la plantilla (el actor no tiene todos sus permisos,
   * o la organización no la tiene). Quien gestiona debe asignarle un rol a mano.
   */
  readonly templateSkipped: boolean;
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
   * rol del sistema de `newRank`, otorgada por `grantedBy`, solo si sus permisos son subconjunto de
   * `actorPermissions` (no escalamiento, ADR 0012).
   */
  revokeRolesAboveRank(input: {
    readonly userId: UserId;
    readonly newRank: Rank;
    readonly grantedBy: UserId;
    readonly actorPermissions: ReadonlySet<Permission>;
  }): Promise<RoleAdjustment>;
}
