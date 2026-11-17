/**
 * Invariantes de seguridad
 * - Corre en la transacción en curso: RLS (`outbox_events_tenant_isolation`) limita la cuenta a la
 *   organización fijada.
 * - Solo cuenta filas; no lee ni devuelve `payload`.
 * - Cuarentena (dead letter) = sin publicar y con `next_attempt_at = 'infinity'` (ver pg-outbox-repository).
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { QuarantinedEventCounter } from '../application/ports/quarantine-alert-ports.js';

export class PgQuarantinedEventCounter implements QuarantinedEventCounter {
  constructor(private readonly transactions: TransactionProvider) {}

  async countQuarantinedEvents(): Promise<number> {
    const result = await this.transactions.current().query<{ quarantined: string }>(
      `select count(*)::text as quarantined
         from outbox_events
        where published_at is null
          and next_attempt_at = 'infinity'`,
    );
    return Number(result.rows[0]?.quarantined ?? '0');
  }
}
