/**
 * Invariantes de seguridad
 * - Corre en la transacción en curso: RLS limita el borrado a la organización fijada (ADR 0038).
 * - Solo borra desafíos vencidos antes del corte, usados o no: `consume` ya exige que no hayan
 *   vencido, así que ninguno de ellos podía validar una ceremonia.
 */
import type { TransactionProvider } from '../../organization/index.js';

export class PgExpiredChallengesPurger {
  readonly table = 'webauthn_challenges';

  constructor(private readonly transactions: TransactionProvider) {}

  // El corte va también fuera de la subconsulta: si otra transacción cambió la fila mientras el
  // DELETE esperaba su bloqueo, Postgres re-evalúa solo estas condiciones sobre la versión nueva.
  async purgeBatch(cutoff: Date, limit: number): Promise<number> {
    const result = await this.transactions.current().query(
      `delete from webauthn_challenges
        where expires_at < $1
          and id in (select id from webauthn_challenges where expires_at < $1 order by expires_at limit $2)`,
      [cutoff, limit],
    );
    return result.rowCount ?? 0;
  }
}
