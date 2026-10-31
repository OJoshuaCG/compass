/**
 * Roles y permisos especiales de una persona ya existente.
 *
 * Un permiso especial es un rol personal oculto (uno por persona): pasa por el mismo motor de
 * autorización, el mismo techo de rango y el mismo no escalamiento que cualquier otro rol.
 *
 * Invariantes de seguridad
 * - Ver los roles de una persona exige `user.invite` sobre ella; cambiarlos exige `role.assign`
 *   (con reautenticación y jerarquía), nunca la sola guarda del controlador.
 * - No escalamiento: quien asigna debe tener TODOS los permisos de cada rol que agrega y de cada
 *   permiso especial; ningún permiso puede superar el techo del rango de la persona.
 * - La Raíz no se modifica; nadie se asigna a sí mismo (la jerarquía no lo permite).
 * - Quitar roles no exige tener sus permisos: retirar autoridad nunca escala privilegios.
 * - Todo cambio escribe su auditoría en la misma transacción; las negaciones también.
 */
import type { Permission } from '@iam/contracts';
import { PERMISSIONS } from '@iam/contracts';

import { DomainError, RANK, err, ok } from '../../../shared/kernel/index.js';
import type {
  IdGenerator,
  RequestContextReader,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UserDirectory, UserRecord } from '../../directory/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { PERMISSION_CEILING } from '../domain/permission-catalog.js';
import { checkRoleAssignment } from '../domain/role-assignment.js';
import type { RoleAssignmentDenial } from '../domain/role-assignment.js';
import type { Authorizer } from './authorizer.js';
import { isPersonalRole } from './ports/role-repository.js';
import type { RoleRecord, RoleRepository } from './ports/role-repository.js';

export interface ManagePersonRolesDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly directory: UserDirectory;
  readonly roles: RoleRepository;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
}

export interface PersonRolesView {
  /** Roles elegibles asignados (sin el rol personal). */
  readonly roles: readonly RoleRecord[];
  /** Permisos del rol personal; vacío si la persona no tiene permisos especiales. */
  readonly specialPermissions: readonly Permission[];
}

export interface PermissionCatalogEntry {
  readonly permission: Permission;
  /** Rango más bajo (número más alto) que puede tener este permiso. */
  readonly maxRank: number;
}

const PERMISSION_ASSIGN = 'role.assign' satisfies Permission;

export class ManagePersonRoles {
  constructor(private readonly deps: ManagePersonRolesDeps) {}

  /** Catálogo de permisos con su techo de rango, para que la pantalla explique qué es asignable. */
  catalog(): Promise<readonly PermissionCatalogEntry[]> {
    const { uow, authorizer } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'user.invite' });
      return PERMISSIONS.map((permission) => ({
        permission,
        maxRank: PERMISSION_CEILING[permission],
      }));
    });
  }

  view(targetId: UserId): Promise<PersonRolesView> {
    const { uow, authorizer, roles } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'user.invite', targetUserId: targetId });
      const assigned = await roles.listLiveAssigned(targetId);
      return splitAssigned(assigned);
    });
  }

  /** Reemplaza los roles elegibles de la persona; el rol personal no se toca. */
  setRoles(
    targetId: UserId,
    roleIds: readonly string[],
  ): Promise<Result<PersonRolesView, DomainError>> {
    const { uow, directory, authorizer, roles } = this.deps;
    return uow.run(async () => {
      await directory.lockHierarchy();
      const target = await this.authorizeOn(targetId);
      const actor = await this.actor();

      const requestedIds = [...new Set(roleIds)];
      const requested = await roles.findByIds(requestedIds);
      if (requested.length !== requestedIds.length) {
        return err(new DomainError('VALIDATION.FAILED', 'Unknown role'));
      }

      const current = splitAssigned(await roles.listLiveAssigned(targetId));
      const currentIds = new Set(current.roles.map((role) => role.id));
      const added = requested.filter((role) => !currentIds.has(role.id));
      const requestedIdSet = new Set(requestedIds);
      const removedIds = current.roles
        .map((role) => role.id)
        .filter((id) => !requestedIdSet.has(id));

      const actorPermissions = await authorizer.actorPermissions();
      for (const role of added) {
        const denial = checkRoleAssignment({
          actorManagesTarget: true, // `authorizeOn` ya exigió la jerarquía
          actorPermissions,
          rolePermissions: role.permissions,
          targetRank: target.rank,
        });
        if (denial !== null) return this.refuse(denial, target.id);
      }

      if (added.length === 0 && removedIds.length === 0) {
        return ok(current);
      }
      for (const role of added) await roles.assign(target.id, role.id, actor.id);
      await roles.unassign(target.id, removedIds);
      await this.record('user.roles_changed', target.id, {
        addedCount: added.length,
        removedCount: removedIds.length,
      });
      return ok(splitAssigned(await roles.listLiveAssigned(target.id)));
    });
  }

  /** Reemplaza los permisos especiales de la persona; un conjunto vacío los retira todos. */
  setSpecialPermissions(
    targetId: UserId,
    permissionsInput: readonly Permission[],
  ): Promise<Result<PersonRolesView, DomainError>> {
    const { uow, directory, authorizer, roles, ids } = this.deps;
    return uow.run(async () => {
      await directory.lockHierarchy();
      const target = await this.authorizeOn(targetId);
      const actor = await this.actor();
      const permissions = [...new Set(permissionsInput)];

      const actorPermissions = await authorizer.actorPermissions();
      const denial = checkRoleAssignment({
        actorManagesTarget: true, // `authorizeOn` ya exigió la jerarquía
        actorPermissions,
        rolePermissions: permissions,
        targetRank: target.rank,
      });
      if (denial !== null) return this.refuse(denial, target.id);

      const personal = await roles.findPersonalOfForUpdate(target.id);
      const previous = new Set(personal?.permissions ?? []);
      const next = new Set(permissions);
      const addedCount = permissions.filter((permission) => !previous.has(permission)).length;
      const removedCount = [...previous].filter((permission) => !next.has(permission)).length;

      const assigned = await roles.listLiveAssigned(target.id);
      const personalIsAssigned =
        personal !== null && assigned.some((role) => role.id === personal.id);

      if (permissions.length === 0) {
        if (personal === null) return ok(splitAssigned(assigned));
        await roles.unassign(target.id, [personal.id]);
        await roles.archive(personal.id, new Date());
      } else if (personal === null) {
        const id = ids.next();
        await roles.insertPersonal({
          id,
          userId: target.id,
          permissions,
          createdBy: actor.id,
        });
        await roles.assign(target.id, id, actor.id);
      } else {
        if (addedCount === 0 && removedCount === 0 && personalIsAssigned) {
          return ok(splitAssigned(assigned));
        }
        await roles.updatePersonalPermissions(personal.id, permissions);
        // Un cambio de rango a la baja puede haber soltado el rol personal; se vuelve a asignar.
        if (!personalIsAssigned) await roles.assign(target.id, personal.id, actor.id);
      }

      await this.record('user.special_permissions_changed', target.id, {
        addedCount,
        removedCount,
      });
      return ok(splitAssigned(await roles.listLiveAssigned(target.id)));
    });
  }

  private async authorizeOn(targetId: UserId): Promise<UserRecord> {
    await this.deps.authorizer.require({ permission: PERMISSION_ASSIGN, targetUserId: targetId });
    const target = await this.deps.directory.findById(targetId);
    // `require` ya negó los objetivos inexistentes o ajenos; esto solo estrecha el tipo.
    if (target === null) {
      throw new DomainError('AUTHZ.HIERARCHY.NOT_IN_SUBTREE', 'Action not allowed');
    }
    if (target.rank === RANK.ROOT) {
      throw new DomainError('USER.ROOT_PROTECTED', 'The root user cannot be modified');
    }
    return target;
  }

  private async actor(): Promise<UserRecord> {
    const actorId = this.deps.context.current().actorId;
    const actor = actorId === null ? null : await this.deps.directory.findById(actorId);
    if (actor === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actor;
  }

  private async refuse(
    denial: RoleAssignmentDenial,
    targetUserId: UserId,
  ): Promise<Result<never, DomainError>> {
    const code = denial === 'ESCALATION' ? 'AUTHZ.ROLE_ESCALATION' : 'AUTHZ.CREATION_NOT_ALLOWED';
    const message =
      denial === 'ESCALATION'
        ? 'Cannot grant permissions you lack'
        : 'A permission exceeds the ceiling of the rank';
    await this.deps.authorizer.auditDenial({
      code,
      permission: PERMISSION_ASSIGN,
      targetUserId,
    });
    return err(new DomainError(code, message));
  }

  private async record(
    action: string,
    targetId: UserId,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    const current = this.deps.context.current();
    const recorded = await this.deps.audit.record({
      action,
      actorId: current.actorId,
      targetType: 'user',
      targetId,
      outcome: 'success',
      reasonCode: null,
      ip: null,
      requestId: current.requestId,
      metadata,
    });
    // Sin auditoría no hay cambio: se aborta la transacción en vez de perderlo en silencio.
    if (!recorded.ok) throw recorded.error;
  }
}

function splitAssigned(assigned: readonly RoleRecord[]): PersonRolesView {
  const personal = assigned.find((role) => isPersonalRole(role));
  return {
    roles: assigned.filter((role) => !isPersonalRole(role)),
    specialPermissions: personal?.permissions ?? [],
  };
}
