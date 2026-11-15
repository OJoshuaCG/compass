/**
 * Grupos: crear, listar y administrar miembros (permisos `group.create` y `group.manage_members`).
 *
 * Invariantes de seguridad
 * - El permiso lo decide el motor de autorización; además, administrar miembros exige ser gestor del grupo
 *   o tener rango de Administrador o superior. Quien no ve un grupo recibe `GROUP.NOT_FOUND` (no se revela
 *   su existencia) y la negación se audita.
 * - Un grupo conserva siempre al menos una persona gestora.
 * - Los gestores son de rango Líder o superior y toda persona miembro debe estar activa.
 * - Cada acción exitosa escribe su auditoría en la misma transacción; sin auditoría no hay cambio.
 */
import type { CreateGroupRequest, GroupMemberRole, Permission } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { canHoldGroupRole, canManageGroupMembers, seesEveryGroup } from '../domain/group-policy.js';
import type { GroupRecord } from '../domain/group-policy.js';
import type { UserRecord } from '../domain/user.js';
import type { ActionAuthorizer } from './manage-users.js';
import type { GroupMemberRow, GroupStore, GroupSummaryRow } from './ports/group-store.js';
import type { UserDirectory } from './ports/user-directory.js';

const CREATE_PERMISSION: Permission = 'group.create';
const MANAGE_MEMBERS_PERMISSION: Permission = 'group.manage_members';
const GROUP_AUDIT_TARGET_TYPE = 'group';

export interface ManageGroupsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: ActionAuthorizer & { requireActiveMember(): Promise<UserRecord> };
  readonly directory: UserDirectory;
  readonly store: GroupStore;
  readonly audit: AuditLog;
}

type Outcome<T> = Result<T, DomainError>;

export interface GroupView extends GroupSummaryRow {
  readonly canManageMembers: boolean;
}

const notFound = (): Outcome<never> => err(new DomainError('GROUP.NOT_FOUND', 'Group not found'));

export class ManageGroups {
  constructor(private readonly deps: ManageGroupsDeps) {}

  create(command: CreateGroupRequest): Promise<Outcome<GroupRecord>> {
    return this.deps.uow.run(async () => {
      const { authorizer, store } = this.deps;
      await authorizer.require({ permission: CREATE_PERMISSION });
      const actor = await authorizer.requireActiveMember();
      const group = await store.insertGroup({
        name: command.name,
        description: command.description ?? null,
        createdBy: actor.id,
      });
      if (group === null) {
        return err(new DomainError('GROUP.NAME_TAKEN', 'A live group with that name exists'));
      }
      // Quien crea el grupo lo gestiona: sin gestor, nadie con rango bajo podría mantenerlo.
      await store.addMember({
        groupId: group.id,
        userId: actor.id,
        role: 'manager',
        addedBy: actor.id,
      });
      await this.record('group.created', group.id, actor.id, {});
      return ok(group);
    });
  }

  list(query: { readonly managedByMe: boolean }): Promise<readonly GroupView[]> {
    return this.deps.uow.run(async () => {
      const { authorizer, store } = this.deps;
      const actor = await authorizer.requireActiveMember();
      const everyGroup = await this.seesEveryGroup(actor);
      const rows = await store.listLive({
        viewerId: actor.id,
        onlyOfViewer: !everyGroup,
        onlyManagedByViewer: query.managedByMe,
      });
      const canUsePermission = (await authorizer.actorPermissions()).has(MANAGE_MEMBERS_PERMISSION);
      return rows.map((row) => ({
        ...row,
        canManageMembers: canUsePermission && canManageGroupMembers(actor.rank, row.roleOfViewer),
      }));
    });
  }

  listMembers(groupId: string): Promise<Outcome<readonly GroupMemberRow[]>> {
    return this.deps.uow.run(async () => {
      const { authorizer, store } = this.deps;
      const actor = await authorizer.requireActiveMember();
      const group = await store.findLive(groupId);
      if (group === null) return notFound();
      if (!(await this.canView(actor, groupId))) return this.denyAsNotFound();
      return ok(await store.listMembers(groupId));
    });
  }

  addMember(
    groupId: string,
    userId: UserId,
    role: GroupMemberRole,
  ): Promise<Outcome<readonly GroupMemberRow[]>> {
    return this.deps.uow.run(async () => {
      const { authorizer, store, directory } = this.deps;
      await authorizer.require({ permission: MANAGE_MEMBERS_PERMISSION });
      const actor = await authorizer.requireActiveMember();
      const group = await store.findLiveForUpdate(groupId);
      if (group === null) return notFound();
      if (!(await this.canAdminister(actor, groupId))) return this.denyAsNotFound();

      // Se bloquea antes de leer el estado: así una baja concurrente no deja a una persona inactiva dentro.
      await store.lockUserRow(userId);
      const target = await directory.findById(userId);
      if (
        target === null ||
        target.status !== 'active' ||
        target.organizationId !== actor.organizationId ||
        !canHoldGroupRole(target.rank, role)
      ) {
        return err(new DomainError('GROUP.MEMBER_INVALID', 'The person cannot join the group'));
      }
      const added = await store.addMember({ groupId, userId, role, addedBy: actor.id });
      if (!added) return err(new DomainError('GROUP.MEMBER_EXISTS', 'Already a member'));
      await this.record('group.member_added', groupId, actor.id, { userId, role });
      return ok(await store.listMembers(groupId));
    });
  }

  removeMember(groupId: string, userId: UserId): Promise<Outcome<readonly GroupMemberRow[]>> {
    return this.deps.uow.run(async () => {
      const { authorizer, store } = this.deps;
      await authorizer.require({ permission: MANAGE_MEMBERS_PERMISSION });
      const actor = await authorizer.requireActiveMember();
      const group = await store.findLiveForUpdate(groupId);
      if (group === null) return notFound();
      if (!(await this.canAdminister(actor, groupId))) return this.denyAsNotFound();

      const role = await store.roleOf(groupId, userId);
      if (role === null) return notFound();
      if (role === 'manager' && (await store.countManagers(groupId)) <= 1) {
        return err(new DomainError('GROUP.LAST_MANAGER', 'A group keeps at least one manager'));
      }
      await store.removeMember(groupId, userId);
      await this.record('group.member_removed', groupId, actor.id, { userId, role });
      return ok(await store.listMembers(groupId));
    });
  }

  private async seesEveryGroup(actor: UserRecord): Promise<boolean> {
    const permissions = await this.deps.authorizer.actorPermissions();
    const hasGroupPermission =
      permissions.has(MANAGE_MEMBERS_PERMISSION) || permissions.has(CREATE_PERMISSION);
    return seesEveryGroup(actor.rank, hasGroupPermission);
  }

  private async canView(actor: UserRecord, groupId: string): Promise<boolean> {
    if (await this.seesEveryGroup(actor)) return true;
    return (await this.deps.store.roleOf(groupId, actor.id)) !== null;
  }

  private async canAdminister(actor: UserRecord, groupId: string): Promise<boolean> {
    return canManageGroupMembers(actor.rank, await this.deps.store.roleOf(groupId, actor.id));
  }

  private async denyAsNotFound(): Promise<Outcome<never>> {
    await this.deps.authorizer.auditDenial({
      code: 'GROUP.NOT_FOUND',
      permission: MANAGE_MEMBERS_PERMISSION,
    });
    return notFound();
  }

  private async record(
    action: string,
    groupId: string,
    actorId: UserId,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    const recorded = await this.deps.audit.record({
      action,
      actorId,
      targetType: GROUP_AUDIT_TARGET_TYPE,
      targetId: groupId,
      outcome: 'success',
      reasonCode: null,
      ip: null,
      requestId: this.deps.context.current().requestId,
      metadata,
    });
    if (!recorded.ok) throw recorded.error;
  }
}
