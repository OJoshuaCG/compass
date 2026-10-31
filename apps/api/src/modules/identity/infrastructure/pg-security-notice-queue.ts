/**
 * Cola del aviso de seguridad sobre la bandeja de salida (outbox, ADR 0035).
 *
 * Invariante de seguridad: el evento se inserta en la transacción EN CURSO (la de la acción que se avisa), así
 * que no hay aviso sin acción ni acción sin aviso: si la transacción revierte, el evento también. La
 * organización sale del ajuste `app.org_id` de la transacción, nunca de un parámetro. Solo ids, tipo y fecha.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  SecurityNoticeEvent,
  SecurityNoticeQueue,
} from '../application/ports/security-notice-queue.js';
import {
  SECURITY_NOTICE_AGGREGATE,
  SECURITY_NOTICE_EVENT_TYPE,
  serializeSecurityNotice,
} from '../domain/security-notice-event.js';

export class PgSecurityNoticeQueue implements SecurityNoticeQueue {
  constructor(private readonly transactions: TransactionProvider) {}

  async enqueue(notice: SecurityNoticeEvent): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        SECURITY_NOTICE_AGGREGATE,
        SECURITY_NOTICE_EVENT_TYPE,
        JSON.stringify(serializeSecurityNotice(notice)),
      ],
    );
  }
}
