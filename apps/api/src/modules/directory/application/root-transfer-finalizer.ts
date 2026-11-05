/**
 * Cierre de una transferencia de la Raíz: completarla, cancelarla o dejarla caducar.
 *
 * Invariantes de seguridad
 * - Solo se llama dentro de la transacción de quien actúa (o del proceso periódico) y con el bloqueo de
 *   jerarquía ya tomado: el intercambio de rangos no puede cruzarse con otra mutación de la jerarquía.
 * - El intercambio, los roles, el retiro de acceso de la Raíz anterior, la anulación de los códigos de
 *   emergencia, el aviso y la auditoría ocurren en la MISMA transacción: o pasa todo o no pasa nada.
 * - La auditoría es el último paso de cada cierre; sin auditoría no hay cambio (el error aborta).
 */
import type { AuditLog } from '../../audit/index.js';
import type { Clock, RequestContextReader, UserId } from '../../../shared/kernel/index.js';
import type { RootTransferCancelReason, RootTransferRecord } from '../domain/root-transfer.js';
import { isEligibleRootTarget } from '../domain/root-transfer.js';
import type { RootTransferNoticeKind } from '../domain/root-transfer-notice.js';
import type {
  EmergencyCodeInvalidator,
  RootAccessRevoker,
  RootHierarchySwap,
  RootRoleHandover,
} from './ports/root-handover.js';
import type { RootTransferNoticeQueue } from './ports/root-transfer-notice-queue.js';
import type { RootTransferStore } from './ports/root-transfer-store.js';
import type { UserDirectory } from './ports/user-directory.js';

export const ROOT_TRANSFER_AUDIT_TARGET_TYPE = 'root_transfer';

export interface RootTransferFinalizerDeps {
  readonly context: RequestContextReader;
  readonly directory: UserDirectory;
  readonly swap: RootHierarchySwap;
  readonly roles: RootRoleHandover;
  readonly access: RootAccessRevoker;
  readonly emergencyCodes: EmergencyCodeInvalidator;
  readonly store: RootTransferStore;
  readonly notices: RootTransferNoticeQueue;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export type SettledOutcome = 'completed' | 'cancelled' | 'expired';

export class RootTransferFinalizer {
  constructor(private readonly deps: RootTransferFinalizerDeps) {}

  /** Cancelación pedida por una persona o automática (`by` nulo). */
  async cancel(
    transfer: RootTransferRecord,
    input: { readonly by: UserId | null; readonly reason: RootTransferCancelReason },
  ): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.store.close(transfer.id, {
      status: 'cancelled',
      closedAt: now,
      cancelledBy: input.by,
      cancelReason: input.reason,
    });
    await this.enqueue('cancelled', transfer, input.by, now);
    await this.record('root_transfer.cancelled', transfer, input.by, {
      reason: input.reason,
    });
  }

  /** La propuesta no se aceptó a tiempo. */
  async expire(transfer: RootTransferRecord): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.store.close(transfer.id, {
      status: 'expired',
      closedAt: now,
      cancelledBy: null,
      cancelReason: 'expired',
    });
    await this.enqueue('expired', transfer, null, now);
    await this.record('root_transfer.expired', transfer, null, {});
  }

  /**
   * Termina la espera: si la destinataria sigue siendo Administradora activa y la Raíz sigue siendo la misma
   * persona activa, se hace el intercambio; si no, la transferencia se cancela sola y avisa.
   */
  async complete(transfer: RootTransferRecord): Promise<'completed' | 'cancelled'> {
    const { directory } = this.deps;
    const from = await directory.findById(transfer.fromUserId);
    const to = await directory.findById(transfer.toUserId);
    const fromStillRoot = from !== null && from.rank === 0 && from.status === 'active';
    if (!fromStillRoot || to === null || !isEligibleRootTarget(to)) {
      await this.cancel(transfer, { by: null, reason: 'target_not_active_admin' });
      return 'cancelled';
    }

    const now = this.deps.clock.now();
    const reassignedReports = await this.deps.swap.swapRoot({
      fromUserId: transfer.fromUserId,
      toUserId: transfer.toUserId,
    });
    await this.deps.roles.promote({ userId: transfer.toUserId, grantedBy: transfer.fromUserId });
    await this.deps.roles.demote({ userId: transfer.fromUserId, grantedBy: transfer.toUserId });
    await this.deps.access.revokeForReenrollment(transfer.fromUserId, now);
    // «invited» obliga a registrar de nuevo los factores en el siguiente inicio de sesión.
    await this.deps.directory.setStatus(transfer.fromUserId, 'invited');
    const emergencyCodesInvalidated = await this.deps.emergencyCodes.invalidateAll(now);

    await this.deps.store.close(transfer.id, {
      status: 'completed',
      closedAt: now,
      cancelledBy: null,
      cancelReason: null,
    });
    await this.enqueue('completed', transfer, null, now);
    await this.record('root_transfer.completed', transfer, null, {
      reassignedReports,
      emergencyCodesInvalidated,
    });
    return 'completed';
  }

  /** Aplica lo que el reloj ya decidió: caducar una propuesta vieja o completar una espera terminada. */
  async settleIfDue(transfer: RootTransferRecord): Promise<SettledOutcome | 'not_due'> {
    const now = this.deps.clock.now().getTime();
    if (transfer.status === 'pending_acceptance' && now >= transfer.expiresAt.getTime()) {
      await this.expire(transfer);
      return 'expired';
    }
    if (
      transfer.status === 'waiting' &&
      transfer.executesAt !== null &&
      now >= transfer.executesAt.getTime()
    ) {
      return this.complete(transfer);
    }
    return 'not_due';
  }

  async enqueue(
    kind: RootTransferNoticeKind,
    transfer: RootTransferRecord,
    actorId: UserId | null,
    occurredAt: Date,
    executesAt: Date | null = null,
  ): Promise<void> {
    await this.deps.notices.enqueue({
      kind,
      transferId: transfer.id,
      fromUserId: transfer.fromUserId,
      toUserId: transfer.toUserId,
      actorId,
      occurredAt,
      executesAt,
    });
  }

  async record(
    action: string,
    transfer: RootTransferRecord,
    actorId: UserId | null,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    const current = this.deps.context.current();
    const recorded = await this.deps.audit.record({
      action,
      actorId,
      targetType: ROOT_TRANSFER_AUDIT_TARGET_TYPE,
      targetId: transfer.id,
      outcome: 'success',
      reasonCode: null,
      ip: null,
      requestId: current.requestId,
      metadata: { fromUserId: transfer.fromUserId, toUserId: transfer.toUserId, ...metadata },
    });
    // Sin auditoría no hay cambio: un campo fuera de la lista blanca o un fallo de almacenamiento abortan.
    if (!recorded.ok) throw recorded.error;
  }
}
