/**
 * Adaptador de bóveda para las bajas (ADR 0009, enmienda 2026-11-04).
 *
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización.
 * - El cálculo de cuentas huérfanas parte de la tabla base `shares` a través de `effective_access` y la une
 *   con `users`: la vista no mira el estado de la persona, y una persona suspendida, invitada o dada de baja
 *   NO cuenta como gestor.
 * - Las cuentas se bloquean con `for update` ordenadas por id (nunca sobre la vista, que no lo admite) para
 *   que dos bajas simultáneas no se crucen.
 * - Nada de lo que se guarda es un secreto: solo ids, el nivel y el motivo fijo `offboarding`.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { ManagementGrantOutcome, OffboardingAccountStore } from '../../directory/index.js';

const SHARE_LEVEL_MANAGE = 'MANAGE';
/** Motivo que queda en la compartición creada por una baja; permite distinguirla de una hecha a mano. */
const OFFBOARDING_SHARE_REASON = 'offboarding';

export class PgOffboardingAccountStore implements OffboardingAccountStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async lockAccountsOnlyManagedBy(leaverId: UserId): Promise<readonly string[]> {
    const queryable = this.transactions.current();
    // Con `for update` en la misma consulta, un cambio de gestores confirmado mientras se espera el bloqueo
    // no se reflejaría en las subconsultas. Por eso se bloquean primero las cuentas que gestiona la persona
    // (por id) y la decisión de quién queda huérfana se lee después, ya con el bloqueo tomado.
    await queryable.query(
      `select a.id
         from accounts a
        where a.status = 'active'
          and exists (
                select 1
                  from effective_access leaver_access
                 where leaver_access.resource_type = 'account'
                   and leaver_access.resource_id = a.id
                   and leaver_access.user_id = $1
                   and leaver_access.level = $2)
        order by a.id
          for update of a`,
      [leaverId, SHARE_LEVEL_MANAGE],
    );
    const result = await queryable.query<{ id: string }>(
      `select a.id
         from accounts a
        where a.status = 'active'
          and exists (
                select 1
                  from effective_access leaver_access
                 where leaver_access.resource_type = 'account'
                   and leaver_access.resource_id = a.id
                   and leaver_access.user_id = $1
                   and leaver_access.level = $2)
          and not exists (
                select 1
                  from effective_access other_access
                  join users other_manager
                    on other_manager.id = other_access.user_id
                   and other_manager.status = 'active'
                 where other_access.resource_type = 'account'
                   and other_access.resource_id = a.id
                   and other_access.level = $2
                   and other_access.user_id <> $1)
        order by a.id`,
      [leaverId, SHARE_LEVEL_MANAGE],
    );
    return result.rows.map((row) => row.id);
  }

  async grantManagement(input: {
    readonly accountId: string;
    readonly granteeId: UserId;
    readonly grantedBy: UserId;
  }): Promise<ManagementGrantOutcome> {
    const queryable = this.transactions.current();
    // Una compartición viva del candidato (aunque vencida) ocupa el índice único: se sube de nivel.
    const upgraded = await queryable.query(
      `update shares
          set level = $3, expires_at = null, granted_by = $4, reason = $5
        where resource_type = 'account'
          and resource_id = $1
          and grantee_type = 'user'
          and grantee_id = $2
          and revoked_at is null`,
      [
        input.accountId,
        input.granteeId,
        SHARE_LEVEL_MANAGE,
        input.grantedBy,
        OFFBOARDING_SHARE_REASON,
      ],
    );
    if (upgraded.rowCount !== null && upgraded.rowCount > 0) return 'upgraded';

    await queryable.query(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by, reason)
       values (nullif(current_setting('app.org_id', true), '')::uuid, 'account', $1, 'user', $2, $3, $4, $5)`,
      [
        input.accountId,
        input.granteeId,
        SHARE_LEVEL_MANAGE,
        input.grantedBy,
        OFFBOARDING_SHARE_REASON,
      ],
    );
    return 'granted';
  }
}
