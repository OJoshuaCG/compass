/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita roles y asignaciones a la organización.
 * - Solo cuentan los roles no archivados.
 */
import { PERMISSIONS } from '@iam/contracts';
import type { Permission } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { RoleRecord, RoleRepository } from '../application/ports/role-repository.js';

const KNOWN = new Set<string>(PERMISSIONS);

/** Ignora permisos desconocidos (por ejemplo, de una versión futura): nunca amplían el acceso. */
const known = (values: readonly string[]): Permission[] =>
  values.filter((value): value is Permission => KNOWN.has(value));

interface RoleRow {
  id: string;
  name: string;
  is_system: boolean;
  permissions: string[];
}

export class PgRoleRepository implements RoleRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async rolePermissionsOf(userId: UserId): Promise<readonly (readonly Permission[])[]> {
    const result = await this.transactions.current().query<{ permissions: string[] }>(
      `select r.permissions
         from user_roles ur
         join roles r on r.organization_id = ur.organization_id and r.id = ur.role_id
        where ur.user_id = $1 and r.archived_at is null`,
      [userId],
    );
    return result.rows.map((row) => known(row.permissions));
  }

  async findByIds(ids: readonly string[]): Promise<readonly RoleRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.transactions
      .current()
      .query<RoleRow>(
        'select id, name, is_system, permissions from roles where id = any($1::uuid[]) and archived_at is null',
        [ids],
      );
    return result.rows.map(toRecord);
  }

  async findSystemRole(name: string): Promise<RoleRecord | null> {
    const result = await this.transactions
      .current()
      .query<RoleRow>(
        'select id, name, is_system, permissions from roles where is_system and name = $1 and archived_at is null',
        [name],
      );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async assign(userId: UserId, roleId: string, grantedBy: UserId): Promise<void> {
    await this.transactions.current().query(
      `insert into user_roles (organization_id, user_id, role_id, granted_by)
       select organization_id, id, $2, $3 from users where id = $1
       on conflict (organization_id, user_id, role_id) do nothing`,
      [userId, roleId, grantedBy],
    );
  }
}

const toRecord = (row: RoleRow): RoleRecord => ({
  id: row.id,
  name: row.name,
  isSystem: row.is_system,
  permissions: known(row.permissions),
});
