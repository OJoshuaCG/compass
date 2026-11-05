/**
 * Transferencia de la Raíz: proponer, aceptar, cancelar y consultar (governance, J3; decisiones del dueño
 * del 2026-11-04, L22 de `odd/tasks/owner-decisions-2026-11-04.md`).
 *
 * Invariantes de seguridad
 * - Toda acción corre bajo el bloqueo de jerarquía de la organización y lee la transferencia abierta con
 *   bloqueo de fila: dos acciones simultáneas se serializan y nunca hay dos transferencias abiertas.
 * - Proponer exige el permiso `org.settings` (el único de tope 0, que solo tiene la Raíz) con
 *   reautenticación reciente; aceptar exige además reautenticación reciente de la persona que recibe.
 * - Solo un Administrador activo puede recibir el puesto; si no lo es, se niega con auditoría.
 * - Cancelar lo puede hacer la Raíz, la persona destinataria o cualquier Administrador activo.
 * - Toda acción exitosa escribe su auditoría y encola su aviso en la misma transacción; las negaciones
 *   también se auditan.
 */
import type { Permission } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import {
  executionDate,
  isEligibleRootTarget,
  proposalExpiry,
  proposalHasExpired,
} from '../domain/root-transfer.js';
import type { RootTransferRecord } from '../domain/root-transfer.js';
import type { UserRecord } from '../domain/user.js';
import type { ActionAuthorizer } from './manage-users.js';
import type { RootTransferStore } from './ports/root-transfer-store.js';
import type { UserDirectory } from './ports/user-directory.js';
import type { RootTransferFinalizer } from './root-transfer-finalizer.js';

/** `org.settings` es el único permiso de tope 0: solo la Raíz lo tiene, y exige reautenticación reciente. */
const ROOT_TRANSFER_PERMISSION: Permission = 'org.settings';
/** Rango máximo (inclusive) de quien puede cancelar o consultar: Raíz (0) y Administradores (1). */
const MAX_RANK_TO_CANCEL_OR_VIEW = 1;

export interface ManageRootTransferDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: ActionAuthorizer & { requireActiveMember(): Promise<UserRecord> };
  readonly directory: UserDirectory;
  readonly store: RootTransferStore;
  readonly finalizer: RootTransferFinalizer;
  readonly clock: Clock;
  /** Ventana de reautenticación reciente en milisegundos (la define el módulo de acceso). */
  readonly reauthWindowMs: number;
}

type Outcome<T> = Result<T, DomainError>;

export interface RootTransferView {
  readonly id: string;
  readonly fromUserId: UserId;
  readonly toUserId: UserId;
  readonly status: RootTransferRecord['status'];
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly executesAt: Date | null;
}

const toView = (transfer: RootTransferRecord): RootTransferView => ({
  id: transfer.id,
  fromUserId: transfer.fromUserId,
  toUserId: transfer.toUserId,
  status: transfer.status,
  requestedAt: transfer.requestedAt,
  expiresAt: transfer.expiresAt,
  acceptedAt: transfer.acceptedAt,
  executesAt: transfer.executesAt,
});

const notFound = (): Outcome<never> =>
  err(new DomainError('ROOT_TRANSFER.NOT_FOUND', 'No open root transfer'));

export class ManageRootTransfer {
  constructor(private readonly deps: ManageRootTransferDeps) {}

  /** La Raíz propone el puesto a un Administrador activo. */
  propose(targetUserId: UserId): Promise<Outcome<RootTransferView>> {
    return this.deps.uow.run(async () => {
      const { directory, store, finalizer } = this.deps;
      await directory.lockHierarchy();
      await this.deps.authorizer.require({ permission: ROOT_TRANSFER_PERMISSION });
      const actorId = this.deps.context.current().actorId;
      if (actorId === null)
        return err(new DomainError('AUTHZ.SESSION', 'Authenticated session required'));

      const target = await directory.findById(targetUserId);
      if (target === null || target.id === actorId || !isEligibleRootTarget(target)) {
        await this.deps.authorizer.auditDenial({
          code: 'ROOT_TRANSFER.TARGET_NOT_ELIGIBLE',
          permission: ROOT_TRANSFER_PERMISSION,
          targetUserId,
        });
        return err(
          new DomainError(
            'ROOT_TRANSFER.TARGET_NOT_ELIGIBLE',
            'The target must be an active Administrator',
          ),
        );
      }

      const open = await store.findOpenForUpdate();
      if (open !== null) {
        // Una propuesta vencida no estorba: se cierra y se permite la nueva.
        const settled = await finalizer.settleIfDue(open);
        if (settled === 'not_due') {
          return err(
            new DomainError('ROOT_TRANSFER.ALREADY_OPEN', 'A root transfer is already open'),
          );
        }
      }

      const now = this.deps.clock.now();
      const created = await store.insert({
        fromUserId: actorId,
        toUserId: target.id,
        requestedAt: now,
        expiresAt: proposalExpiry(now),
      });
      await finalizer.enqueue('requested', created, actorId, now);
      await finalizer.record('root_transfer.requested', created, actorId, {
        expiresAt: created.expiresAt.toISOString(),
      });
      return ok(toView(created));
    });
  }

  /** La persona destinataria acepta; desde ese instante corren las 72 horas de espera. */
  accept(): Promise<Outcome<RootTransferView>> {
    return this.deps.uow.run(async () => {
      const { directory, store, finalizer, authorizer } = this.deps;
      await directory.lockHierarchy();
      const actor = await authorizer.requireActiveMember();
      const open = await store.findOpenForUpdate();
      if (open === null || open.status !== 'pending_acceptance' || open.toUserId !== actor.id) {
        return notFound();
      }

      const now = this.deps.clock.now();
      if (proposalHasExpired(open, now)) {
        await finalizer.expire(open);
        return err(new DomainError('ROOT_TRANSFER.EXPIRED', 'The proposal has expired'));
      }

      if (!this.hasFreshReauth(now)) {
        await authorizer.auditDenial({
          code: 'AUTHZ.REAUTH_REQUIRED',
          permission: ROOT_TRANSFER_PERMISSION,
          targetUserId: open.fromUserId,
        });
        return err(new DomainError('AUTHZ.REAUTH_REQUIRED', 'Recent re-authentication required'));
      }
      if (!isEligibleRootTarget(actor)) {
        await finalizer.cancel(open, { by: null, reason: 'target_not_active_admin' });
        return notFound();
      }

      const executesAt = executionDate(now);
      await store.markAccepted(open.id, now, executesAt);
      const accepted: RootTransferRecord = {
        ...open,
        status: 'waiting',
        acceptedAt: now,
        executesAt,
      };
      await finalizer.enqueue('accepted', accepted, actor.id, now, executesAt);
      await finalizer.record('root_transfer.accepted', accepted, actor.id, {
        executesAt: executesAt.toISOString(),
      });
      return ok(toView(accepted));
    });
  }

  /** La Raíz, la persona destinataria o cualquier Administrador activo detienen la transferencia. */
  cancel(): Promise<Outcome<void>> {
    return this.deps.uow.run(async () => {
      const { directory, store, finalizer, authorizer } = this.deps;
      await directory.lockHierarchy();
      const actor = await authorizer.requireActiveMember();
      if (actor.rank > MAX_RANK_TO_CANCEL_OR_VIEW) {
        await authorizer.auditDenial({
          code: 'AUTHZ.PERMISSION',
          permission: ROOT_TRANSFER_PERMISSION,
        });
        return err(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'));
      }
      const open = await store.findOpenForUpdate();
      if (open === null) return notFound();
      if (await this.settleIfExpired(open)) return notFound();

      await finalizer.cancel(open, { by: actor.id, reason: 'manual' });
      return ok(undefined);
    });
  }

  /** La transferencia abierta, visible solo para la Raíz y los Administradores. */
  current(): Promise<Outcome<RootTransferView | null>> {
    return this.deps.uow.run(async () => {
      const actor = await this.deps.authorizer.requireActiveMember();
      if (actor.rank > MAX_RANK_TO_CANCEL_OR_VIEW) {
        await this.deps.authorizer.auditDenial({
          code: 'AUTHZ.PERMISSION',
          permission: ROOT_TRANSFER_PERMISSION,
        });
        return err(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'));
      }
      const open = await this.deps.store.findOpenForUpdate();
      return ok(open === null ? null : toView(open));
    });
  }

  private hasFreshReauth(now: Date): boolean {
    const reauthAt = this.deps.context.current().reauthAt;
    return reauthAt !== null && now.getTime() - reauthAt.getTime() <= this.deps.reauthWindowMs;
  }

  /** Si la propuesta ya había caducado, la cierra y avisa; devuelve si lo hizo. */
  private async settleIfExpired(open: RootTransferRecord): Promise<boolean> {
    if (!proposalHasExpired(open, this.deps.clock.now())) return false;
    await this.deps.finalizer.expire(open);
    return true;
  }
}
