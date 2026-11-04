import type { RootTransferNoticePayload } from '../../domain/root-transfer-notice.js';

/**
 * Encola los avisos de la transferencia de la Raíz. Se escribe en la misma transacción que el cambio
 * (bandeja de salida, ADR 0035): no hay aviso sin cambio ni cambio sin aviso.
 */
export interface RootTransferNoticeQueue {
  enqueue(notice: RootTransferNoticePayload): Promise<void>;
}
