import type { DuePendingTotp } from '../../domain/pending-totp-notice.js';

/**
 * Acceso del barrido a los segundos factores pendientes vencidos. Todo corre en la transacción en curso,
 * con la organización fijada por RLS (nunca por un argumento).
 */
export interface PendingTotpNoticeStore {
  /**
   * Reclama hasta `limit` registros `pending` registrados en `registeredBefore` o antes, que aún no tengan
   * `pending_notice_at` y cuya credencial no esté archivada, y les marca `pending_notice_at = noticeAt`.
   * Con `FOR UPDATE SKIP LOCKED`: dos barridos simultáneos nunca reclaman el mismo registro.
   */
  claimDue(
    registeredBefore: Date,
    noticeAt: Date,
    limit: number,
  ): Promise<readonly DuePendingTotp[]>;
  /** Escribe el evento del aviso en `outbox_events`; debe ir en la MISMA transacción que `claimDue`. */
  enqueue(notice: DuePendingTotp): Promise<void>;
}
