/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita el borrado a la organización fijada.
 * - Solo borra el estado de fuentes ya archivadas; nunca el de una fuente activa o suspendida.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { ArchivedSourcePollStateStore } from '../application/ports/purge-ports.js';

export class PgArchivedSourcePollStateStore implements ArchivedSourcePollStateStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async purgeArchivedSourcePollState(limit: number): Promise<number> {
    const result = await this.transactions.current().query(
      `delete from mail_source_poll_state
        where ctid in (
          select poll_state.ctid
            from mail_source_poll_state as poll_state
            join mail_sources as source
              on source.organization_id = poll_state.organization_id
             and source.id = poll_state.source_id
           where source.status = 'archived'
           limit $1
        )`,
      [limit],
    );
    return result.rowCount ?? 0;
  }
}
