/**
 * Gestión de personas del equipo: suspender, reactivar, dar de baja, cambiar rango y transferir
 * responsable.
 *
 * Invariantes de seguridad
 * - Cada acción pasa por el motor de autorización con el usuario objetivo (jerarquía incluida); el
 *   motor audita cualquier negación. Las reglas de negocio que lo complementan también auditan.
 * - La Raíz nunca se suspende, se da de baja, cambia de rango ni se transfiere.
 * - Suspender, dar de baja o cambiar el rango cierra todas sus sesiones en la misma transacción que
 *   el cambio.
 * - Dar de baja reasigna a sus subordinados vigentes a su propio responsable (nadie queda huérfano)
 *   y revoca las invitaciones pendientes que dejó.
 * - La organización nunca se queda sin una persona ACTIVA de rango 1: bajar de rango, suspender o dar
 *   de baja a la última se niega (con auditoría) bajo el bloqueo de jerarquía.
 * - Bajar de rango quita en la misma transacción los roles que exceden el nuevo tope (y asigna la
 *   plantilla del rango si no queda ninguno); las comparticiones que la persona otorgó no se revocan,
 *   solo se informan. Subir de rango exige un motivo, que va a la auditoría.
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
import {
  canChangeRank,
  canTransferManager,
  isRankPromotion,
  wouldLeaveNoActiveAdministrator,
} from '../domain/management-policy.js';
import type { UserRecord } from '../domain/user.js';
import type { AssignedRoleRevoker, RoleSummary } from './ports/assigned-role-revoker.js';
import type { RankChangeNoticeQueue } from './ports/rank-change-notice-queue.js';
import type { SharedAccountSummary, SharedByLister } from './ports/shared-by-lister.js';
import type { UserDirectory } from './ports/user-directory.js';

/**
 * Tope de comparticiones que se devuelven en la respuesta (coincide con el contrato). El total real
 * se informa aparte y es lo que se audita.
 */
const MAX_SHARED_ACCOUNTS_IN_RESPONSE = 100;

/**
 * Largo máximo de un texto en los metadatos de auditoría (`MAX_STRING_LENGTH` de la lista blanca);
 * una lista de ids que lo supere haría fallar la transacción, así que se trunca antes.
 */
const AUDIT_METADATA_TEXT_MAX_LENGTH = 256;
const AUDIT_ID_LIST_SEPARATOR = ',';

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
  readonly roles: AssignedRoleRevoker;
  readonly sharedBy: SharedByLister;
  readonly rankChangeNotices: RankChangeNoticeQueue;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

type Outcome = Result<void, DomainError>;

/** Lo que el cambio de rango deja a la vista de quien lo hizo. */
export interface RankChangeOutcome {
  readonly removedRoles: readonly RoleSummary[];
  readonly assignedRole: RoleSummary | null;
  /** A lo sumo `MAX_SHARED_ACCOUNTS_IN_RESPONSE`; vacío al subir de rango. */
  readonly sharedAccounts: readonly SharedAccountSummary[];
  /** Total real de comparticiones vivas, aunque la lista esté truncada. */
  readonly sharedAccountCount: number;
}

export class ManageUsers {
  constructor(private readonly deps: ManageUsersDeps) {}

  suspend(targetId: UserId): Promise<Outcome> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const target = await this.authorizeOn('user.deactivate', targetId);
      if (target.status !== 'active') return invalidState();
      const blocked = await this.refuseIfLastAdministrator(target, null, 'user.deactivate');
      if (blocked !== null) return blocked;
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
      await this.deps.directory.lockHierarchy();
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
      const blocked = await this.refuseIfLastAdministrator(target, null, 'user.deactivate');
      if (blocked !== null) return blocked;
      const at = this.deps.clock.now();
      const reassigned = await directory.reassignReports(target.id, target.managedBy);
      await directory.setStatus(target.id, 'deactivated');
      await this.deps.sessions.revokeAllOfUser(target.id, at);
      await invitations.revokePendingOfUser(target.id, at);
      await this.record('user.deactivated', target.id, { reassignedReports: reassigned });
      return ok(undefined);
    });
  }

  /**
   * `reason` es obligatorio solo si el cambio sube la autoridad; al bajar es opcional. Va a la
   * auditoría (no al correo) recortado de espacios.
   */
  changeRank(
    targetId: UserId,
    newRank: Rank,
    reason?: string,
  ): Promise<Result<RankChangeOutcome, DomainError>> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const { directory, authorizer } = this.deps;
      const target = await this.authorizeOn('user.change_rank', targetId);
      if (target.status === 'deactivated' || target.managedBy === null) return invalidState();
      // Cambiar al mismo rango no es un cambio: se rechaza en vez de auditar un evento vacío.
      if (newRank === target.rank) return invalidState();
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
      // Después de la autorización: quien no puede cambiar el rango no debe averiguar así cuántas
      // personas administradoras quedan.
      const blocked = await this.refuseIfLastAdministrator(target, newRank, 'user.change_rank');
      if (blocked !== null) return blocked;

      const normalizedReason = reason?.trim() ?? '';
      const isPromotion = isRankPromotion(target.rank, newRank);
      if (isPromotion && normalizedReason === '') {
        return this.refuse(
          'USER.RANK_REASON_REQUIRED',
          'user.change_rank',
          target.id,
          'A reason is required to raise the rank',
        );
      }

      await directory.setRank(target.id, newRank);
      const at = this.deps.clock.now();
      // Solo bajar de rango puede dejar roles por encima del nuevo tope; al subir, el tope solo se
      // relaja y no hay nada que quitar.
      const adjustment = isPromotion
        ? { removedRoles: [], assignedRole: null }
        : await this.deps.roles.revokeRolesAboveRank({
            userId: target.id,
            newRank,
            grantedBy: actor.id,
          });
      // Se informa de lo que la persona compartió, sin revocarlo: decidirlo es de quien gestiona.
      const shared = isPromotion
        ? { total: 0, rows: [] }
        : await this.deps.sharedBy.listLiveGrantedBy(
            target.id,
            at,
            MAX_SHARED_ACCOUNTS_IN_RESPONSE,
          );
      // El motor lee el rango en cada petición, así que la autoridad ya cambió al confirmar; las
      // sesiones se cierran igualmente en la misma transacción para que la persona vuelva a
      // autenticarse con su nuevo rango (AU-9, ADR 0014, defensa en profundidad).
      await this.deps.sessions.revokeAllOfUser(target.id, at);
      await this.deps.rankChangeNotices.enqueue({
        targetId: target.id,
        changedBy: actor.id,
        fromRank: target.rank,
        toRank: newRank,
        changedAt: at,
      });
      // La auditoría va al final: retiene el bloqueo de la cadena el menor tiempo posible (ADR 0023).
      await this.record('user.rank_changed', target.id, {
        fromRank: target.rank,
        toRank: newRank,
        reason: normalizedReason === '' ? null : normalizedReason,
        removedRoles: joinIdsWithinAuditLimit(adjustment.removedRoles.map((role) => role.id)),
        removedRoleCount: adjustment.removedRoles.length,
        assignedRole: adjustment.assignedRole?.id ?? null,
        sharedAccountCount: shared.total,
      });
      return ok({
        removedRoles: adjustment.removedRoles,
        assignedRole: adjustment.assignedRole,
        sharedAccounts: shared.rows,
        sharedAccountCount: shared.total,
      });
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

  /**
   * Niega (y audita) la acción si dejaría a la organización sin una persona activa de rango 1. El
   * conteo solo se consulta cuando el objetivo es una persona administradora activa.
   */
  private async refuseIfLastAdministrator(
    target: UserRecord,
    newRank: Rank | null,
    permission: Permission,
  ): Promise<Result<never, DomainError> | null> {
    const targetIsActiveAdministrator =
      target.status === 'active' && target.rank === RANK.ADMINISTRATOR;
    if (!targetIsActiveAdministrator) return null;
    const activeAdministratorCount = await this.deps.directory.countActiveByRank(
      RANK.ADMINISTRATOR,
    );
    if (!wouldLeaveNoActiveAdministrator({ target, newRank, activeAdministratorCount })) {
      return null;
    }
    return this.refuse(
      'USER.LAST_ADMINISTRATOR',
      permission,
      target.id,
      'The organization must keep at least one active Administrator',
    );
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
  ): Promise<Result<never, DomainError>> {
    await this.deps.authorizer.auditDenial({ code, permission, targetUserId });
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
    // Sin auditoría no hay acción: un campo fuera de la lista blanca o un fallo de almacenamiento
    // deben abortar la transacción, no perderse en silencio.
    if (!recorded.ok) throw recorded.error;
  }
}

const invalidState = (): Result<never, DomainError> =>
  err(new DomainError('USER.INVALID_STATE', 'The user is not in a state that allows this action'));

/**
 * Une ids con coma sin pasar del límite de texto de la auditoría: se quitan ids COMPLETOS del final
 * (nunca se corta uno a la mitad). El conteo total va aparte en `removedRoleCount`.
 */
function joinIdsWithinAuditLimit(ids: readonly string[]): string {
  const kept: string[] = [];
  let length = 0;
  for (const id of ids) {
    const added = id.length + (kept.length === 0 ? 0 : AUDIT_ID_LIST_SEPARATOR.length);
    if (length + added > AUDIT_METADATA_TEXT_MAX_LENGTH) break;
    kept.push(id);
    length += added;
  }
  return kept.join(AUDIT_ID_LIST_SEPARATOR);
}
