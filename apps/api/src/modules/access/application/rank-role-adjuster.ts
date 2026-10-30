/**
 * Ajusta los roles de una persona cuando baja de rango (implementa el puerto que define `directory`).
 *
 * Invariantes de seguridad
 * - Corre en la transacción del cambio de rango: rango y roles cambian juntos o no cambian.
 * - Se quitan los roles que contienen algún permiso sobre el techo del nuevo rango; ningún permiso
 *   por encima del techo sobrevive al cambio.
 * - Si el recorte deja a la persona sin ningún rol vigente, recibe la plantilla de su nuevo rango
 *   (la misma que al aceptar una invitación); nunca se le asigna un rol que no sea de sistema.
 */
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import type { AssignedRoleRevoker, RoleAdjustment } from '../../directory/index.js';
import { rolesExceedingRank } from '../domain/role-assignment.js';
import { SYSTEM_ROLE_KEY_BY_RANK, systemRole } from '../domain/system-roles.js';
import type { RoleRepository } from './ports/role-repository.js';

export interface RankRoleAdjusterDeps {
  readonly roles: RoleRepository;
}

export class RankRoleAdjuster implements AssignedRoleRevoker {
  constructor(private readonly deps: RankRoleAdjusterDeps) {}

  async revokeRolesAboveRank(input: {
    readonly userId: UserId;
    readonly newRank: Rank;
    readonly grantedBy: UserId;
  }): Promise<RoleAdjustment> {
    const { roles } = this.deps;
    const assigned = await roles.listLiveAssigned(input.userId);
    const exceeding = rolesExceedingRank(assigned, input.newRank);
    if (exceeding.length === 0) return { removedRoles: [], assignedRole: null };

    await roles.unassign(
      input.userId,
      exceeding.map((role) => role.id),
    );
    const removedRoles = exceeding.map((role) => ({ id: role.id, name: role.name }));

    // Solo se asigna la plantilla si el recorte dejó a la persona sin ningún rol vigente; quien
    // conserva otros roles ya tiene permisos y no se le amplían por el cambio.
    const remainingRoleCount = assigned.length - exceeding.length;
    if (remainingRoleCount > 0) return { removedRoles, assignedRole: null };

    const template = await roles.findSystemRole(
      systemRole(SYSTEM_ROLE_KEY_BY_RANK[input.newRank]).name,
    );
    if (template === null) return { removedRoles, assignedRole: null };
    await roles.assign(input.userId, template.id, input.grantedBy);
    return { removedRoles, assignedRole: { id: template.id, name: template.name } };
  }
}
