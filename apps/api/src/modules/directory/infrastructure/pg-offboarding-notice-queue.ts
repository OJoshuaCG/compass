/**
 * Cola de los avisos de una baja sobre la bandeja de salida (outbox, ADR 0035).
 *
 * Invariante de seguridad: el evento se inserta en la transacción EN CURSO (la de la baja), así que no hay
 * aviso sin baja ni baja sin aviso: si la transacción revierte, el evento también. La organización sale del
 * ajuste `app.org_id` de la transacción, nunca de un parámetro. Solo ids, conteos y la hora en el contenido.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { OffboardingNoticeQueue } from '../application/ports/offboarding-notice-queue.js';
import {
  OFFBOARDING_NOTICE_AGGREGATE,
  OFFBOARDING_NOTICE_EVENT_TYPE,
  serializeOffboardingNotice,
} from '../domain/offboarding-notice.js';
import type { OffboardingNoticePayload } from '../domain/offboarding-notice.js';

export class PgOffboardingNoticeQueue implements OffboardingNoticeQueue {
  constructor(private readonly transactions: TransactionProvider) {}

  async enqueue(notice: OffboardingNoticePayload): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        OFFBOARDING_NOTICE_AGGREGATE,
        OFFBOARDING_NOTICE_EVENT_TYPE,
        JSON.stringify(serializeOffboardingNotice(notice)),
      ],
    );
  }
}
