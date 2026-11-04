/**
 * Cola de alertas de infraestructura sobre la bandeja de salida (outbox, ADR 0035).
 *
 * Invariante de seguridad: el evento se inserta en la transacción EN CURSO y la organización sale del ajuste
 * `app.org_id` de esa transacción, nunca de un parámetro. El contenido es solo el código de una lista cerrada
 * y la hora: ningún detalle del error que originó la alerta.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { InfrastructureAlertQueue } from '../application/ports/infrastructure-alert-queue.js';
import {
  INFRASTRUCTURE_ALERT_AGGREGATE,
  INFRASTRUCTURE_ALERT_EVENT_TYPE,
  serializeInfrastructureAlert,
} from '../domain/infrastructure-alert.js';
import type { InfrastructureAlertPayload } from '../domain/infrastructure-alert.js';

export class PgInfrastructureAlertQueue implements InfrastructureAlertQueue {
  constructor(private readonly transactions: TransactionProvider) {}

  async enqueue(alert: InfrastructureAlertPayload): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        INFRASTRUCTURE_ALERT_AGGREGATE,
        INFRASTRUCTURE_ALERT_EVENT_TYPE,
        JSON.stringify(serializeInfrastructureAlert(alert)),
      ],
    );
  }
}
