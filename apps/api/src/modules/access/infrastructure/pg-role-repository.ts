/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita roles y asignaciones a la organización.
 * - Solo cuentan los roles no archivados.
 */
import { PERMISSIONS } from '@iam/contracts';
import type { Permission } from '@iam/contracts';

import {
  decodeKeysetCursor,
  isBitPart,
  isPlainTextPart,
  isUuidPart,
  toKeysetPage,
} from '../../../shared/kernel/index.js';
import type { KeysetPage, KeysetRequest, UserId } from '../../../shared/kernel/index.js';
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

  async listLivePage(page: KeysetRequest): Promise<KeysetPage<RoleRecord>> {
    // Las plantillas del sistema van primero: `sort_group` 0 para ellas y 1 para las personalizadas,
    // de modo que toda la clave de orden sea ascendente y se pueda comparar como una tupla.
    const params: unknown[] = [];
    let afterCursor = '';
    const after = decodeKeysetCursor(page.cursor, [isBitPart, isPlainTextPart, isUuidPart]);
    if (after !== null) {
      params.push(after[0], after[1], after[2]);
      afterCursor =
        'and (case when is_system then 0 else 1 end, lower(name), id) > ($1::int, $2::text, $3::uuid)';
    }
    params.push(page.limit + 1);
    const result = await this.transactions
      .current()
      .query<RoleRow & { sort_group: number; sort_name: string }>(
        `select id, name, is_system, permissions,
              case when is_system then 0 else 1 end as sort_group, lower(name) as sort_name
         from roles
        where archived_at is null ${afterCursor}
        order by case when is_system then 0 else 1 end, lower(name), id
        limit $${String(params.length)}`,
        params,
      );
    const keyset = toKeysetPage(result.rows, page.limit, (row) => [
      String(row.sort_group),
      row.sort_name,
      row.id,
    ]);
    return { rows: keyset.rows.map(toRecord), nextCursor: keyset.nextCursor };
  }

  async insertCustom(input: {
    id: string;
    name: string;
    permissions: readonly Permission[];
    createdBy: UserId;
  }): Promise<'inserted' | 'name_taken'> {
    const client = this.transactions.current();
    // Savepoint: un nombre repetido es un resultado esperado y no debe abortar la transacción.
    await client.query('savepoint insert_role');
    try {
      await client.query(
        `insert into roles (id, organization_id, name, is_system, permissions, created_by)
         values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, false, $3, $4)`,
        [input.id, input.name, [...input.permissions], input.createdBy],
      );
      await client.query('release savepoint insert_role');
      return 'inserted';
    } catch (error) {
      await client.query('rollback to savepoint insert_role');
      if ((error as { code?: string }).code === '23505') return 'name_taken';
      throw error;
    }
  }

  async updateCustom(input: {
    id: string;
    name: string;
    permissions: readonly Permission[];
  }): Promise<'updated' | 'name_taken' | 'not_found'> {
    const client = this.transactions.current();
    // Savepoint: igual que al insertar, un nombre repetido es un resultado esperado.
    await client.query('savepoint update_role');
    try {
      // `is_system` en el filtro: aunque el caso de uso falle, una plantilla nunca se modifica.
      const result = await client.query(
        `update roles set name = $2, permissions = $3, version = version + 1
          where id = $1 and archived_at is null and not is_system`,
        [input.id, input.name, [...input.permissions]],
      );
      await client.query('release savepoint update_role');
      return result.rowCount === 0 ? 'not_found' : 'updated';
    } catch (error) {
      await client.query('rollback to savepoint update_role');
      if ((error as { code?: string }).code === '23505') return 'name_taken';
      throw error;
    }
  }

  async findLiveById(id: string): Promise<RoleRecord | null> {
    const result = await this.transactions
      .current()
      .query<RoleRow>(
        'select id, name, is_system, permissions from roles where id = $1 and archived_at is null',
        [id],
      );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findLiveByIdForUpdate(id: string): Promise<RoleRecord | null> {
    const result = await this.transactions
      .current()
      .query<RoleRow>(
        'select id, name, is_system, permissions from roles where id = $1 and archived_at is null for update',
        [id],
      );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async archive(id: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update roles set archived_at = $2 where id = $1 and archived_at is null', [id, at]);
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
