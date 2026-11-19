/**
 * Cola de avisos de logout sobre la bandeja de salida (outbox, ADR 0035).
 *
 * Invariante de seguridad: el evento se inserta en la transacción EN CURSO (la de la revocación) y la
 * organización sale del ajuste `app.org_id` de esa transacción, nunca de un parámetro. El contenido es solo
 * `clientId` y `sid`: el token firmado jamás se guarda.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { BackchannelLogoutQueue } from '../application/ports/backchannel-logout-queue.js';
import {
  BACKCHANNEL_LOGOUT_AGGREGATE,
  BACKCHANNEL_LOGOUT_EVENT_TYPE,
  serializeBackchannelLogoutTarget,
} from '../domain/backchannel-logout.js';
import type { BackchannelLogoutTarget } from '../domain/backchannel-logout.js';

export class PgBackchannelLogoutQueue implements BackchannelLogoutQueue {
  constructor(private readonly transactions: TransactionProvider) {}

  async enqueue(target: BackchannelLogoutTarget): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        BACKCHANNEL_LOGOUT_AGGREGATE,
        BACKCHANNEL_LOGOUT_EVENT_TYPE,
        JSON.stringify(serializeBackchannelLogoutTarget(target)),
      ],
    );
  }
}
