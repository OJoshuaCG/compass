/**
 * Roles que acompañan la transferencia de la Raíz (implementa el puerto que define `directory`).
 *
 * Invariantes de seguridad
 * - Corre en la transacción de la transferencia, DESPUÉS del intercambio de rangos: el disparador de techos
 *   de la base solo mira el rango vigente al asignar, así que la nueva Raíz ya es rango 0 cuando recibe Root.
 * - La Raíz anterior pierde todo rol con un permiso sobre el techo del Administrador (el rol Root incluido);
 *   los demás roles de rango 1 se conservan. Si se queda sin ninguno, recibe la plantilla de Administrador.
 * - No hay "no escalamiento" que comprobar: la transferencia ya fue autorizada por la Raíz con reautenticación
 *   y por la persona destinataria con reautenticación.
 */
import type { RootRoleHandover } from '../../directory/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import { rolesExceedingRank } from '../domain/role-assignment.js';
import { SYSTEM_ROLE_KEY_BY_RANK, systemRole } from '../domain/system-roles.js';
import { isPersonalRole } from './ports/role-repository.js';
import type { RoleRepository } from './ports/role-repository.js';

/** Techo de rango de un Administrador: lo máximo que conserva quien deja la Raíz. */
const ADMINISTRATOR_RANK = 1;

export interface RootRoleHandoverAdapterDeps {
  readonly roles: RoleRepository;
}

export class RootRoleHandoverAdapter implements RootRoleHandover {
  constructor(private readonly deps: RootRoleHandoverAdapterDeps) {}

  async promote(input: { readonly userId: UserId; readonly grantedBy: UserId }): Promise<void> {
    const { roles } = this.deps;
    const rootTemplate = await roles.findSystemRole(systemRole(SYSTEM_ROLE_KEY_BY_RANK[0]).name);
    if (rootTemplate === null) {
      throw new Error('The Root system role is missing in this organization');
    }
    const alreadyAssigned = (await roles.listLiveAssigned(input.userId)).some(
      (role) => role.id === rootTemplate.id,
    );
    if (alreadyAssigned) return;
    await roles.assign(input.userId, rootTemplate.id, input.grantedBy);
  }

  async demote(input: { readonly userId: UserId; readonly grantedBy: UserId }): Promise<void> {
    const { roles } = this.deps;
    const assigned = await roles.listLiveAssigned(input.userId);
    const exceeding = rolesExceedingRank(assigned, ADMINISTRATOR_RANK);
    if (exceeding.length > 0) {
      await roles.unassign(
        input.userId,
        exceeding.map((role) => role.id),
      );
    }

    const remainingEligible = assigned.filter(
      (role) => !isPersonalRole(role) && !exceeding.some((removed) => removed.id === role.id),
    );
    if (remainingEligible.length > 0) return;

    const template = await roles.findSystemRole(
      systemRole(SYSTEM_ROLE_KEY_BY_RANK[ADMINISTRATOR_RANK]).name,
    );
    if (template === null) {
      throw new Error('The Administrator system role is missing in this organization');
    }
    await roles.assign(input.userId, template.id, input.grantedBy);
  }
}
