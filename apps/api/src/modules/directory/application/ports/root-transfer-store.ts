import type { UserId } from '../../../../shared/kernel/index.js';
import type { RootTransferCancelReason, RootTransferRecord } from '../../domain/root-transfer.js';

export interface NewRootTransfer {
  readonly fromUserId: UserId;
  readonly toUserId: UserId;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
}

export interface RootTransferClosing {
  readonly status: 'completed' | 'cancelled' | 'expired';
  readonly closedAt: Date;
  /** Quién canceló; nulo si la cancelación fue automática o si se completó. */
  readonly cancelledBy: UserId | null;
  /** Obligatorio al cancelar o caducar; nulo si se completó. */
  readonly cancelReason: RootTransferCancelReason | null;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface RootTransferStore {
  /** La transferencia abierta de la organización (si hay), bloqueada hasta el fin de la transacción. */
  findOpenForUpdate(): Promise<RootTransferRecord | null>;
  insert(transfer: NewRootTransfer): Promise<RootTransferRecord>;
  markAccepted(id: string, acceptedAt: Date, executesAt: Date): Promise<void>;
  close(id: string, closing: RootTransferClosing): Promise<void>;
}
