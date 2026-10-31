/**
 * Invariantes de seguridad
 * - Todo corre con la organización fijada por RLS: el trabajador la fija con `TenantScope.runAs` y la
 *   transacción independiente la hereda del mismo contexto (nunca de un argumento).
 * - Solo guarda ids y el nombre del manejador: ningún contenido del evento.
 * - Sin clave foránea hacia `outbox_events` (migración 0019): el trabajador retiene `FOR UPDATE` sobre esa
 *   fila mientras el manejador corre, y esta escritura va en otra conexión; la clave foránea esperaría ese
 *   bloqueo y bloquearía al manejador contra su propia transacción.
 */
import type { TransactionProvider, UnitOfWork } from '../../organization/index.js';
import type { OutboxDeliveryReceipts } from '../application/ports/outbox-delivery-receipts.js';

export class PgOutboxDeliveryReceipts implements OutboxDeliveryReceipts {
  constructor(
    private readonly transactions: TransactionProvider,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async wasDelivered(eventId: string, handlerKey: string): Promise<boolean> {
    const result = await this.transactions.current().query(
      `select 1
         from outbox_deliveries
        where organization_id = nullif(current_setting('app.org_id', true), '')::uuid
          and event_id = $1
          and handler_key = $2`,
      [eventId, handlerKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markDelivered(eventId: string, handlerKey: string): Promise<void> {
    await this.unitOfWork.runIndependent(async () => {
      await this.transactions.current().query(
        `insert into outbox_deliveries (organization_id, event_id, handler_key)
         values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2)
         on conflict (organization_id, event_id, handler_key) do nothing`,
        [eventId, handlerKey],
      );
    });
  }
}
