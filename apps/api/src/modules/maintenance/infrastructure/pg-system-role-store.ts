/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización fijada.
 * - Lee y escribe solo filas con `is_system` y sin archivar; un rol personalizado nunca se modifica,
 *   aunque el caso de uso fallara.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { StoredSystemRole, SystemRoleStore } from '../application/ports/system-role-ports.js';

export class PgSystemRoleStore implements SystemRoleStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async listLiveSystemRoles(): Promise<readonly StoredSystemRole[]> {
    const result = await this.transactions.current().query<StoredSystemRole>(
      `select id, name, permissions
           from roles
          where is_system and archived_at is null
          order by id
            for update`,
    );
    return result.rows;
  }

  async replacePermissions(roleId: string, permissions: readonly string[]): Promise<boolean> {
    const result = await this.transactions.current().query(
      `update roles
          set permissions = $2::text[], version = version + 1
        where id = $1 and is_system and archived_at is null`,
      [roleId, permissions],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
