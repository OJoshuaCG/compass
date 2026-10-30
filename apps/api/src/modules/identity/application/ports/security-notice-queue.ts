import type { UserId } from '../../../../shared/kernel/index.js';
import type { OutboxSecurityNoticeKind } from '../../domain/security-notice-event.js';

/** Datos del aviso de seguridad a la dueña de la cuenta. No lleva dirección de red, dispositivo ni secretos. */
export interface SecurityNoticeEvent {
  readonly userId: UserId;
  readonly kind: OutboxSecurityNoticeKind;
  readonly occurredAt: Date;
}

/**
 * Encola el aviso por correo. Debe escribirse en la misma transacción que la acción que se avisa (bandeja
 * de salida, ADR 0035) para que no haya aviso sin cambio ni cambio sin aviso.
 */
export interface SecurityNoticeQueue {
  enqueue(notice: SecurityNoticeEvent): Promise<void>;
}
