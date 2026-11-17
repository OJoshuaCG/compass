/**
 * Invariantes de seguridad
 * - Corre en la transacción en curso: RLS limita la consulta a la organización fijada.
 * - Solo mira el código de la alerta (lista cerrada) y la fecha de creación; no devuelve contenido.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { InfrastructureAlertHistory } from '../application/ports/infrastructure-alert-history.js';
import {
  INFRASTRUCTURE_ALERT_EVENT_TYPE,
  type InfrastructureAlertCode,
} from '../domain/infrastructure-alert.js';

export class PgInfrastructureAlertHistory implements InfrastructureAlertHistory {
  constructor(private readonly transactions: TransactionProvider) {}

  async hasAlertSince(code: InfrastructureAlertCode, since: Date): Promise<boolean> {
    const result = await this.transactions.current().query<{ found: boolean }>(
      `select exists (
         select 1
           from outbox_events
          where type = $1
            and payload ->> 'code' = $2
            and created_at >= $3
       ) as found`,
      [INFRASTRUCTURE_ALERT_EVENT_TYPE, code, since],
    );
    return result.rows[0]?.found === true;
  }
}
