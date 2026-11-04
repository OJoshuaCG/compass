import type { OffboardingNoticePayload } from '../../domain/offboarding-notice.js';

/**
 * Encola los avisos de una baja (a quien recibe las cuentas, a Administradores y Raíz si alguna quedó sin
 * responsable, y el informe a quien dio la baja). Debe escribirse en la misma transacción que la baja
 * (bandeja de salida, ADR 0035) para que no haya aviso sin baja ni baja sin aviso.
 */
export interface OffboardingNoticeQueue {
  enqueue(notice: OffboardingNoticePayload): Promise<void>;
}
