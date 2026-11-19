import type { BackchannelLogoutTarget } from '../../domain/backchannel-logout.js';

/** Cola de avisos de logout sobre el outbox: inserta en la transacción EN CURSO (la de la revocación). */
export interface BackchannelLogoutQueue {
  enqueue(target: BackchannelLogoutTarget): Promise<void>;
}
