/**
 * Transferencia de la Raíz (governance, J3; decisiones del dueño del 2026-11-04, L22 de
 * `odd/tasks/owner-decisions-2026-11-04.md`).
 *
 * Dominio puro: estados, plazos y quién puede recibir el puesto. Nada aquí toca la base ni el reloj.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { UserSubject } from './user.js';

/** La espera corre desde la aceptación: la Raíz actual siempre tiene 72 horas reales para arrepentirse. */
export const ROOT_TRANSFER_WAIT_HOURS = 72;
/** Una propuesta que nadie acepta caduca a los 7 días. */
export const ROOT_TRANSFER_PROPOSAL_VALID_DAYS = 7;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

/** Rango del Administrador: el único que puede recibir el puesto de Raíz. */
export const ROOT_TRANSFER_TARGET_RANK = 1;

export type RootTransferStatus =
  'pending_acceptance' | 'waiting' | 'completed' | 'cancelled' | 'expired';

export type RootTransferCancelReason = 'manual' | 'target_not_active_admin' | 'expired';

export interface RootTransferRecord {
  readonly id: string;
  readonly fromUserId: UserId;
  readonly toUserId: UserId;
  readonly status: RootTransferStatus;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly executesAt: Date | null;
}

/** Estados en los que la transferencia sigue abierta (solo puede haber una por organización). */
export const isOpenTransfer = (transfer: RootTransferRecord): boolean =>
  transfer.status === 'pending_acceptance' || transfer.status === 'waiting';

/** Solo un Administrador activo puede recibir el puesto; suspendidas, invitadas y dadas de baja no. */
export const isEligibleRootTarget = (user: UserSubject): boolean =>
  user.rank === ROOT_TRANSFER_TARGET_RANK && user.status === 'active';

export const proposalExpiry = (requestedAt: Date): Date =>
  new Date(requestedAt.getTime() + ROOT_TRANSFER_PROPOSAL_VALID_DAYS * MILLISECONDS_PER_DAY);

export const executionDate = (acceptedAt: Date): Date =>
  new Date(acceptedAt.getTime() + ROOT_TRANSFER_WAIT_HOURS * MILLISECONDS_PER_HOUR);

/** ¿La propuesta ya no puede aceptarse? El límite mismo ya cuenta como caducada. */
export const proposalHasExpired = (transfer: RootTransferRecord, now: Date): boolean =>
  transfer.status === 'pending_acceptance' && now.getTime() >= transfer.expiresAt.getTime();

/** ¿Terminó la espera de 72 horas? */
export const waitHasElapsed = (transfer: RootTransferRecord, now: Date): boolean =>
  transfer.status === 'waiting' &&
  transfer.executesAt !== null &&
  now.getTime() >= transfer.executesAt.getTime();
