/**
 * Adaptador de bóveda y grupos para las bajas (ADR 0009, enmienda 2026-11-04; governance §2.1 paso 3).
 *
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización.
 * - Solo se revocan las comparticiones DIRECTAS de la persona que se va; las que ella otorgó a otros no se
 *   tocan (decisión vigente, ver `manage-users.ts`).
 * - Revocar deja `revoked_at` y `revoked_by`; nunca se borra una compartición, para conservar el rastro.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { OffboardingAccessCleanup } from '../../directory/index.js';

/** Posición de VER en `share_level_rank`: VER, EDITAR y GESTIONAR cuentan; USAR no (no ve el secreto). */
const MINIMUM_VIEW_LEVEL_RANK = 2;

export class PgOffboardingAccessCleanup implements OffboardingAccessCleanup {
  constructor(private readonly transactions: TransactionProvider) {}

  async listAccountsWithViewOrMoreAccess(userId: UserId): Promise<readonly string[]> {
    const queryable = this.transactions.current();
    const exposureQuery = `select a.id
         from effective_access access
         join accounts a on a.id = access.resource_id
        where access.resource_type = 'account'
          and access.user_id = $1
          and share_level_rank(access.level) >= $2
          and a.archived_at is null
        order by a.id`;
    // Compartir y crear credenciales bloquean la cuenta. Se bloquean primero (por id, el mismo orden que el
    // resto) y se relee después: con `for update` la lectura podría ser anterior a un cambio que acaba de
    // confirmarse. Queda una ventana mínima: una compartición nueva sobre una cuenta que no estaba en la
    // primera lectura.
    await queryable.query(`${exposureQuery} for update of a`, [userId, MINIMUM_VIEW_LEVEL_RANK]);
    const result = await queryable.query<{ id: string }>(exposureQuery, [
      userId,
      MINIMUM_VIEW_LEVEL_RANK,
    ]);
    return result.rows.map((row) => row.id);
  }

  async revokeDirectShares(input: {
    readonly userId: UserId;
    readonly revokedBy: UserId;
  }): Promise<number> {
    const result = await this.transactions.current().query(
      `update shares
          set revoked_at = now(), revoked_by = $2
        where grantee_type = 'user'
          and grantee_id = $1
          and revoked_at is null`,
      [input.userId, input.revokedBy],
    );
    return result.rowCount ?? 0;
  }

  async removeFromAllGroups(userId: UserId): Promise<number> {
    const result = await this.transactions
      .current()
      .query('delete from group_memberships where user_id = $1', [userId]);
    return result.rowCount ?? 0;
  }
}
