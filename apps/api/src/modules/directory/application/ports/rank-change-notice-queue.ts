import type { Rank, UserId } from '../../../../shared/kernel/index.js';

/** Datos del aviso de cambio de rango. No lleva el motivo: va a la auditoría, no al correo. */
export interface RankChangeNotice {
  readonly targetId: UserId;
  /** Quien hizo el cambio; el correo a la persona afectada incluye su nombre. */
  readonly changedBy: UserId;
  readonly fromRank: Rank;
  readonly toRank: Rank;
  readonly changedAt: Date;
}

/**
 * Encola el aviso por correo a la persona afectada. Debe escribirse en la misma transacción que el
 * cambio (bandeja de salida, ADR 0035) para que no haya aviso sin cambio ni cambio sin aviso.
 */
export interface RankChangeNoticeQueue {
  enqueue(notice: RankChangeNotice): Promise<void>;
}
