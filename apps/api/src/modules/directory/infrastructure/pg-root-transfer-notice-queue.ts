/**
 * Cola de los avisos de la transferencia de la Raíz sobre la bandeja de salida (outbox, ADR 0035).
 *
 * Invariante de seguridad: el evento se inserta en la transacción EN CURSO, así que no hay aviso sin cambio
 * ni cambio sin aviso. La organización sale de `app.org_id`; el contenido solo lleva ids y fechas.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { RootTransferNoticeQueue } from '../application/ports/root-transfer-notice-queue.js';
import {
  ROOT_TRANSFER_NOTICE_AGGREGATE,
  ROOT_TRANSFER_NOTICE_EVENT_TYPE,
  serializeRootTransferNotice,
} from '../domain/root-transfer-notice.js';
import type { RootTransferNoticePayload } from '../domain/root-transfer-notice.js';

export class PgRootTransferNoticeQueue implements RootTransferNoticeQueue {
  constructor(private readonly transactions: TransactionProvider) {}

  async enqueue(notice: RootTransferNoticePayload): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        ROOT_TRANSFER_NOTICE_AGGREGATE,
        ROOT_TRANSFER_NOTICE_EVENT_TYPE,
        JSON.stringify(serializeRootTransferNotice(notice)),
      ],
    );
  }
}
