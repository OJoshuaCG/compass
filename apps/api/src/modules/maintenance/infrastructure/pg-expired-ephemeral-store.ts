/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita el borrado a la organización fijada.
 * - Solo borra filas ya vencidas; nunca una reserva o un desafío vigentes.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { ExpiredEphemeralStore } from '../application/ports/purge-ports.js';

export class PgExpiredEphemeralStore implements ExpiredEphemeralStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async purgeIdempotencyKeys(expiredBefore: Date, limit: number): Promise<number> {
    const result = await this.transactions.current().query(
      `delete from idempotency_keys
        where ctid in (select ctid from idempotency_keys where expires_at <= $1 limit $2)`,
      [expiredBefore, limit],
    );
    return result.rowCount ?? 0;
  }

  async purgeWebauthnChallenges(expiredBefore: Date, limit: number): Promise<number> {
    const result = await this.transactions.current().query(
      `delete from webauthn_challenges
        where ctid in (select ctid from webauthn_challenges where expires_at <= $1 limit $2)`,
      [expiredBefore, limit],
    );
    return result.rowCount ?? 0;
  }
}
