/**
 * Roles personalizados: listar, crear, editar y archivar.
 *
 * Invariantes de seguridad
 * - Crear, editar o archivar exige `role.manage`; ver la lista, `user.invite` (quien invita puede adjuntar roles y debe
 *   saber cuáles hay; `role.assign` exige reautenticación y no sirve para solo consultar).
 * - No escalamiento: un rol personalizado solo contiene permisos que su creador tiene.
 * - Las plantillas del sistema no se archivan ni se modifican.
 * - Archivar un rol deja sin efecto sus permisos en quienes lo tenían (solo cuentan los vigentes).
 * - Todo cambio escribe su auditoría en la misma transacción; las negaciones también.
 */
import type { Permission } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  IdGenerator,
  RequestContextReader,
  Result,
} from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { effectivePermissions } from '../domain/effective-permissions.js';
import { isSubsetOfCreator } from '../domain/role-assignment.js';
import type { Authorizer } from './authorizer.js';
import type { RoleRecord, RoleRepository } from './ports/role-repository.js';
import type { UserDirectory } from '../../directory/index.js';

export interface ManageRolesDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly directory: UserDirectory;
  readonly roles: RoleRepository;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export class ManageRoles {
  constructor(private readonly deps: ManageRolesDeps) {}

  list(): Promise<readonly RoleRecord[]> {
    const { uow, authorizer, roles } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'user.invite' });
      return roles.listLive();
    });
  }

  create(input: {
    readonly name: string;
    readonly permissions: readonly Permission[];
  }): Promise<Result<RoleRecord, DomainError>> {
    const { context, uow, authorizer, directory, roles, ids, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'role.manage' });
      const current = context.current();
      const actor = current.actorId === null ? null : await directory.findById(current.actorId);
      if (actor === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');

      const permissions = [...new Set(input.permissions)];
      const own = effectivePermissions(await roles.rolePermissionsOf(actor.id), actor.rank);
      if (!isSubsetOfCreator(permissions, own)) {
        await authorizer.auditDenial({ code: 'AUTHZ.ROLE_ESCALATION', permission: 'role.manage' });
        return err(new DomainError('AUTHZ.ROLE_ESCALATION', 'Cannot grant permissions you lack'));
      }
      const id = ids.next();
      const name = input.name.trim();
      if (
        (await roles.insertCustom({ id, name, permissions, createdBy: actor.id })) === 'name_taken'
      ) {
        return err(new DomainError('ROLE.NAME_TAKEN', 'A role with that name already exists'));
      }
      await audit.record({
        action: 'role.created',
        actorId: actor.id,
        targetType: 'role',
        targetId: id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { permissionCount: permissions.length },
      });
      return ok({ id, name, isSystem: false, permissions });
    });
  }

  update(
    roleId: string,
    input: { readonly name: string; readonly permissions: readonly Permission[] },
  ): Promise<Result<RoleRecord, DomainError>> {
    const { context, uow, authorizer, directory, roles, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'role.manage' });
      const current = context.current();
      const actor = current.actorId === null ? null : await directory.findById(current.actorId);
      if (actor === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');

      // Con bloqueo de fila: la comprobación de escalamiento se hace sobre lo que realmente se reemplaza.
      const role = await roles.findLiveByIdForUpdate(roleId);
      if (role === null) return err(new DomainError('NOT_FOUND', 'Role not found'));
      if (role.isSystem) {
        await authorizer.auditDenial({ code: 'ROLE.SYSTEM_PROTECTED', permission: 'role.manage' });
        return err(new DomainError('ROLE.SYSTEM_PROTECTED', 'System roles cannot be changed'));
      }

      const permissions = [...new Set(input.permissions)];
      const own = effectivePermissions(await roles.rolePermissionsOf(actor.id), actor.rank);
      // Los titulares ya usan los permisos actuales y recibirán los nuevos al instante (no hay caché),
      // así que el editor debe tener ambos conjuntos: con solo los nuevos podría tocar un rol que lo supera.
      const touched = [...new Set<Permission>([...role.permissions, ...permissions])];
      if (!isSubsetOfCreator(touched, own)) {
        await authorizer.auditDenial({ code: 'AUTHZ.ROLE_ESCALATION', permission: 'role.manage' });
        return err(new DomainError('AUTHZ.ROLE_ESCALATION', 'Cannot grant permissions you lack'));
      }

      const name = input.name.trim();
      const outcome = await roles.updateCustom({ id: role.id, name, permissions });
      if (outcome === 'name_taken') {
        return err(new DomainError('ROLE.NAME_TAKEN', 'A role with that name already exists'));
      }
      // Sin filas cambiadas no hay cambio que auditar ni que confirmar al cliente.
      if (outcome === 'not_found') return err(new DomainError('NOT_FOUND', 'Role not found'));
      await audit.record({
        action: 'role.updated',
        actorId: actor.id,
        targetType: 'role',
        targetId: role.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {
          addedCount: permissions.filter((permission) => !role.permissions.includes(permission))
            .length,
          removedCount: role.permissions.filter((permission) => !permissions.includes(permission))
            .length,
          renamed: name !== role.name,
        },
      });
      return ok({ id: role.id, name, isSystem: false, permissions });
    });
  }

  archive(roleId: string): Promise<Result<void, DomainError>> {
    const { context, uow, authorizer, roles, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'role.manage' });
      const role = await roles.findLiveById(roleId);
      if (role === null) return err(new DomainError('NOT_FOUND', 'Role not found'));
      if (role.isSystem) {
        await authorizer.auditDenial({ code: 'ROLE.SYSTEM_PROTECTED', permission: 'role.manage' });
        return err(new DomainError('ROLE.SYSTEM_PROTECTED', 'System roles cannot be changed'));
      }
      await roles.archive(role.id, clock.now());
      const current = context.current();
      await audit.record({
        action: 'role.archived',
        actorId: current.actorId,
        targetType: 'role',
        targetId: role.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });
      return ok(undefined);
    });
  }
}
