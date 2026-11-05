/**
 * Anula los códigos de emergencia de la organización cuando la Raíz cambia de manos.
 *
 * Invariantes de seguridad
 * - Corre en la transacción de la transferencia con la organización fijada por RLS: solo toca los códigos de
 *   emergencia de esa organización y nunca los de recuperación ordinaria de otra persona.
 * - Los códigos nuevos los emite Operaciones con las dos custodias (ADR de reemisión tras transferencia);
 *   mientras tanto no hay recuperación de emergencia.
 */
import type { EmergencyCodeInvalidator } from '../../directory/index.js';
import type { TransactionProvider } from '../../organization/index.js';

export class PgEmergencyCodeInvalidator implements EmergencyCodeInvalidator {
  constructor(private readonly transactions: TransactionProvider) {}

  async invalidateAll(at: Date): Promise<number> {
    const result = await this.transactions.current().query(
      `update user_recovery_codes
          set used_at = $1
        where used_at is null and kind = 'emergency'`,
      [at],
    );
    return result.rowCount ?? 0;
  }
}
