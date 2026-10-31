/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS (`outbox_events_tenant_isolation` y
 *   `outbox_deliveries_tenant_isolation`) limita el borrado a la organización fijada.
 * - Solo elige eventos con `published_at` no nulo y anterior al corte. Los pendientes y los de cuarentena
 *   (`published_at` nulo, `next_attempt_at = 'infinity'`) nunca cumplen esa condición, y el borrado de
 *   eventos la repite por si algo cambiara entre las dos sentencias.
 * - Borra primero los acuses y luego los eventos, en la misma transacción: no quedan acuses huérfanos y, si
 *   algo falla, ninguna de las dos mitades se confirma.
 * - No lee ni registra el contenido (`payload`): solo ids.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  OutboxRetentionBatchResult,
  OutboxRetentionStore,
} from '../application/ports/purge-ports.js';

export class PgOutboxRetentionStore implements OutboxRetentionStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async purgePublishedEvents(
    publishedBefore: Date,
    limit: number,
  ): Promise<OutboxRetentionBatchResult> {
    const transaction = this.transactions.current();

    // Los más antiguos primero: el orden hace determinista qué eventos entran en cada lote.
    const selected = await transaction.query<{ id: string }>(
      `select id
         from outbox_events
        where published_at is not null
          and published_at < $1
        order by published_at, id
        limit $2`,
      [publishedBefore, limit],
    );
    const eventIds = selected.rows.map((row) => row.id);
    if (eventIds.length === 0) return { events: 0, deliveries: 0 };

    const deletedDeliveries = await transaction.query(
      'delete from outbox_deliveries where event_id = any($1::uuid[])',
      [eventIds],
    );
    const deletedEvents = await transaction.query(
      `delete from outbox_events
        where id = any($1::uuid[])
          and published_at is not null
          and published_at < $2`,
      [eventIds, publishedBefore],
    );

    return { events: deletedEvents.rowCount ?? 0, deliveries: deletedDeliveries.rowCount ?? 0 };
  }
}
