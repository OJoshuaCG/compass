import type { UserId } from '../../../../shared/kernel/index.js';
import type { AuditOutcome } from '../../domain/audit-event.js';

export interface AuditEventCountQuery {
  readonly actorId: UserId;
  readonly action: string;
  readonly outcome: AuditOutcome;
  /** Solo cuentan los eventos posteriores a este instante (ventana móvil). */
  readonly since: Date;
}

/**
 * Lectura de conteos sobre la auditoría. Existe para los límites que usan la auditoría como única
 * fuente de verdad (ADR 0031: revelaciones por persona y hora) sin crear un contador paralelo.
 * Corre en la transacción en curso, con la organización fijada por RLS.
 */
export interface AuditEventCounter {
  count(query: AuditEventCountQuery): Promise<number>;
}
