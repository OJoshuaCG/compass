/**
 * Gestión de personas del equipo: suspender, reactivar, dar de baja, cambiar rango y transferir
 * responsable.
 *
 * Invariantes de seguridad
 * - Cada acción pasa por el motor de autorización con el usuario objetivo (jerarquía incluida); el
 *   motor audita cualquier negación. Las reglas de negocio que lo complementan también auditan.
 * - La Raíz nunca se suspende, se da de baja, cambia de rango ni se transfiere.
 * - Suspender o dar de baja cierra todas sus sesiones en la misma transacción que el cambio.
 * - Dar de baja reasigna a sus subordinados vigentes a su propio responsable (nadie queda huérfano)
 *   y revoca las invitaciones pendientes que dejó.
 * - Toda acción exitosa escribe su auditoría en la misma transacción.
 */
import type { ErrorCode, Permission } from '@iam/contracts';

import { DomainError, RANK, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  Rank,
  RequestContextReader,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { canChangeRank, canTransferManager } from '../domain/management-policy.js';
import type { UserRecord } from '../domain/user.js';
import type { UserDirectory } from './ports/user-directory.js';

/** Lo que este caso de uso necesita del motor de autorización (que vive en el módulo de acceso). */
export interface ActionAuthorizer {
  require(request: {
    readonly permission: Permission;
    readonly targetUserId?: UserId;
  }): Promise<unknown>;
  auditDenial(input: {
    readonly code: ErrorCode;
    readonly permission: Permission;
    readonly targetUserId?: UserId;
  }): Promise<void>;
}

/** Cierre de sesiones, implementado por identidad y cableado en la composición. */
export interface SessionRevoker {
  revokeAllOfUser(userId: UserId, at: Date): Promise<void>;
}

/** Revocación de invitaciones pendientes, implementada por identidad. */
export interface InvitationRevoker {
  revokePendingOfUser(userId: UserId, at: Date): Promise<void>;
}

export interface ManageUsersDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: ActionAuthorizer;
  readonly directory: UserDirectory;
  readonly sessions: SessionRevoker;
  readonly invitations: InvitationRevoker;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

type Outcome = Result<void, DomainError>;

export class ManageUsers {
  constructor(private readonly deps: ManageUsersDeps) {}

  suspend(targetId: UserId): Promise<Outcome> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const target = await this.authorizeOn('user.deactivate', targetId);
      if (target.status !== 'active') return invalidState();
      return this.changeStatus(target, 'suspended', 'user.suspended');
    });
  }

  reactivate(targetId: UserId): Promise<Outcome> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const target = await this.authorizeOn('user.update', targetId);
      if (target.status !== 'suspended') return invalidState();
      return this.changeStatus(target, 'active', 'user.reactivated');
    });
  }

  /** El responsable cierra todas las sesiones de una persona a su cargo (p. ej. ante un dispositivo perdido). */
  revokeSessions(targetId: UserId): Promise<Outcome> {
    return this.deps.uow.run(async () => {
      const target = await this.authorizeOn('user.deactivate', targetId);
      await this.deps.sessions.revokeAllOfUser(target.id, this.deps.clock.now());
      await this.record('user.sessions_revoked', target.id, {});
      return ok(undefined);
    });
  }

  deactivate(targetId: UserId): Promise<Outcome> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const { directory, invitations } = this.deps;
      const target = await this.authorizeOn('user.deactivate', targetId);
      if (target.status === 'deactivated' || target.managedBy === null) return invalidState();
      const at = this.deps.clock.now();
      const reassigned = await directory.reassignReports(target.id, target.managedBy);
      await directory.setStatus(target.id, 'deactivated');
      await this.deps.sessions.revokeAllOfUser(target.id, at);
      await invitations.revokePendingOfUser(target.id, at);
      await this.record('user.deactivated', target.id, { reassignedReports: reassigned });
      return ok(undefined);
    });
  }

  changeRank(targetId: UserId, newRank: Rank): Promise<Outcome> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const { directory, authorizer } = this.deps;
      const target = await this.authorizeOn('user.change_rank', targetId);
      if (target.status === 'deactivated' || target.managedBy === null) return invalidState();
      const actor = await this.actor();
      const manager = await directory.findById(target.managedBy);
      // El responsable siempre tiene más autoridad (rango menor) que la persona a su cargo.
      if (manager === null || newRank <= manager.rank) {
        return this.refuse(
          'USER.MANAGER_RANK_INVALID',
          'user.change_rank',
          target.id,
          'The new rank must be below its responsible',
        );
      }
      const hasReports = await directory.hasReports(target.id);
      if (newRank > target.rank && hasReports) {
        return this.refuse(
          'USER.HAS_REPORTS',
          'user.change_rank',
          target.id,
          'Reassign its reports before lowering the rank',
        );
      }
      const allowed = canChangeRank({
        actor,
        target,
        targetInActorSubtree: await directory.isInSubtree(actor.id, target.id),
        newRank,
        targetHasReports: hasReports,
      });
      if (!allowed) {
        await authorizer.auditDenial({
          code: 'AUTHZ.CREATION_NOT_ALLOWED',
          permission: 'user.change_rank',
          targetUserId: target.id,
        });
        return err(new DomainError('AUTHZ.CREATION_NOT_ALLOWED', 'Rank not allowed for your role'));
      }
      await directory.setRank(target.id, newRank);
      await this.record('user.rank_changed', target.id, { fromRank: target.rank, toRank: newRank });
      return ok(undefined);
    });
  }

  transferManager(targetId: UserId, newManagerId: UserId): Promise<Outcome> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const { directory, authorizer } = this.deps;
      const target = await this.authorizeOn('user.transfer', targetId);
      if (target.status === 'deactivated' || target.managedBy === null) return invalidState();
      const actor = await this.actor();
      const newManager = await directory.findById(newManagerId);
      if (newManager?.status !== 'active') {
        await authorizer.auditDenial({
          code: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
          permission: 'user.transfer',
          targetUserId: target.id,
        });
        return err(new DomainError('AUTHZ.HIERARCHY.NOT_IN_SUBTREE', 'Action not allowed'));
      }
      if (newManager.rank >= target.rank) {
        return this.refuse(
          'USER.MANAGER_RANK_INVALID',
          'user.transfer',
          target.id,
          'The new responsible must have more authority',
        );
      }
      const allowed = canTransferManager({
        actor,
        target,
        targetInActorSubtree: await directory.isInSubtree(actor.id, target.id),
        newManager,
        newManagerIsActorOrInSubtree:
          actor.rank === RANK.ROOT ||
          newManager.id === actor.id ||
          (await directory.isInSubtree(actor.id, newManager.id)),
      });
      if (!allowed) {
        await authorizer.auditDenial({
          code: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
          permission: 'user.transfer',
          targetUserId: target.id,
        });
        return err(new DomainError('AUTHZ.HIERARCHY.NOT_IN_SUBTREE', 'Action not allowed'));
      }
      await directory.setManager(target.id, newManager.id);
      await this.record('user.manager_changed', target.id, { newManagerId: newManager.id });
      return ok(undefined);
    });
  }

  // -----------------------------------------------------------------------------------------------

  private async changeStatus(
    target: UserRecord,
    status: 'active' | 'suspended',
    action: 'user.suspended' | 'user.reactivated',
  ): Promise<Outcome> {
    await this.deps.directory.setStatus(target.id, status);
    if (status === 'suspended') {
      await this.deps.sessions.revokeAllOfUser(target.id, this.deps.clock.now());
    }
    await this.record(action, target.id, {});
    return ok(undefined);
  }

  /** Autoriza con jerarquía y devuelve al objetivo; la Raíz queda protegida aunque la política cambie. */
  private async authorizeOn(permission: Permission, targetId: UserId): Promise<UserRecord> {
    await this.deps.authorizer.require({ permission, targetUserId: targetId });
    const target = await this.deps.directory.findById(targetId);
    // `require` ya negó los objetivos inexistentes o ajenos; esto solo estrecha el tipo.
    if (target === null)
      throw new DomainError('AUTHZ.HIERARCHY.NOT_IN_SUBTREE', 'Action not allowed');
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
    code: ErrorCode,
    permission: Permission,
    targetUserId: UserId,
    message: string,
  ): Promise<Outcome> {
    await this.deps.authorizer.auditDenial({ code, permission, targetUserId });
    return err(new DomainError(code, message));
  }

  private async record(
    action: string,
    targetId: UserId,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    const current = this.deps.context.current();
    await this.deps.audit.record({
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
  }
}

const invalidState = (): Outcome =>
  err(new DomainError('USER.INVALID_STATE', 'The user is not in a state that allows this action'));
