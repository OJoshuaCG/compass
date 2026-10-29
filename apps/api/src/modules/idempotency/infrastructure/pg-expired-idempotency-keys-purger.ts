/**
 * Invariantes de seguridad
 * - Corre en la transacción en curso: RLS limita el borrado a la organización fijada (ADR 0038).
 * - Solo borra claves vencidas antes del corte; la aplicación ya trata una clave vencida como libre.
 */
import type { TransactionProvider } from '../../organization/index.js';

export class PgExpiredIdempotencyKeysPurger {
  readonly table = 'idempotency_keys';

  constructor(private readonly transactions: TransactionProvider) {}

  // El corte va también fuera de la subconsulta: si `takeOver` renovó la fila mientras el DELETE
  // esperaba su bloqueo, Postgres re-evalúa solo estas condiciones sobre la versión nueva y la respeta.
  async purgeBatch(cutoff: Date, limit: number): Promise<number> {
    const result = await this.transactions.current().query(
      `delete from idempotency_keys
        where expires_at < $1
          and id in (select id from idempotency_keys where expires_at < $1 order by expires_at limit $2)`,
      [cutoff, limit],
    );
    return result.rowCount ?? 0;
  }
}
