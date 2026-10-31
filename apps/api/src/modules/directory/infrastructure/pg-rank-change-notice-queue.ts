/**
 * Cola del aviso de cambio de rango sobre la bandeja de salida (outbox, ADR 0035).
 *
 * Invariante de seguridad: el evento se inserta en la transacción EN CURSO (la del cambio de rango), así que
 * no hay aviso sin cambio ni cambio sin aviso: si la transacción revierte, el evento también. La organización
 * sale del ajuste `app.org_id` de la transacción, nunca de un parámetro. Solo ids y números en el contenido.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  RankChangeNotice,
  RankChangeNoticeQueue,
} from '../application/ports/rank-change-notice-queue.js';
import {
  RANK_CHANGE_NOTICE_AGGREGATE,
  RANK_CHANGE_NOTICE_EVENT_TYPE,
  serializeRankChangeNotice,
} from '../domain/rank-change-notice.js';

export class PgRankChangeNoticeQueue implements RankChangeNoticeQueue {
  constructor(private readonly transactions: TransactionProvider) {}

  async enqueue(notice: RankChangeNotice): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        RANK_CHANGE_NOTICE_AGGREGATE,
        RANK_CHANGE_NOTICE_EVENT_TYPE,
        JSON.stringify(serializeRankChangeNotice(notice)),
      ],
    );
  }
}
