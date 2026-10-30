/**
 * Invariantes de seguridad
 * - Toda consulta corre en la transacción en curso: RLS limita las filas a la organización.
 * - Los campos de orden salen de una lista blanca fija; nada del cliente se interpola en SQL.
 * - El directorio solo devuelve usuarios activos y solo nombre, correo y rango.
 */
import { hasControlCharacter } from '@iam/contracts';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';

import { asOrganizationId, asUserId, isRank } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  DirectoryPage,
  DirectoryQuery,
  DirectoryRow,
  ManagedPage,
  ManagedRow,
  NewUser,
  UserDirectory,
} from '../application/ports/user-directory.js';
import type { UserRecord, UserStatus } from '../domain/user.js';

const SORT_COLUMN = {
  displayName: 'display_name',
  email: 'email',
  rank: 'rank',
} as const;

interface UserRow extends QueryResultRow {
  id: string;
  organization_id: string;
  email: string;
  display_name: string;
  rank: number;
  status: UserStatus;
  managed_by: string | null;
  created_by: string | null;
  locale: 'es-MX' | 'en-US';
  timezone: string;
}

const UNIQUE_VIOLATION = '23505';

const USER_COLUMNS =
  'id, organization_id, email, display_name, rank, status, managed_by, created_by, locale, timezone';

export class PgUserDirectory implements UserDirectory {
  constructor(private readonly transactions: TransactionProvider) {}

  async findById(id: UserId): Promise<UserRecord | null> {
    const result = await this.transactions.current().query<UserRow>(
      `select ${USER_COLUMNS}
           from users where id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async existsByEmail(email: string): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query('select 1 from users where email = lower($1)', [email]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async insert(user: NewUser): Promise<'inserted' | 'email_taken'> {
    const client = this.transactions.current();
    // Savepoint: un correo repetido es un resultado esperado y no debe abortar la transacción.
    await client.query('savepoint insert_user');
    try {
      await client.query(
        `insert into users (id, organization_id, email, display_name, rank, status, managed_by, created_by, locale, timezone)
         values ($1, $2, lower($3), $4, $5, $6, $7, $8, $9, $10)`,
        [
          user.id,
          user.organizationId,
          user.email,
          user.displayName,
          user.rank,
          user.status,
          user.managedBy,
          user.createdBy,
          user.locale,
          user.timezone,
        ],
      );
      await client.query('release savepoint insert_user');
      return 'inserted';
    } catch (error) {
      await client.query('rollback to savepoint insert_user');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'email_taken';
      throw error;
    }
  }

  async setStatus(id: UserId, status: UserStatus): Promise<void> {
    await this.transactions
      .current()
      .query('update users set status = $2 where id = $1', [id, status]);
  }

  async isInSubtree(managerId: UserId, userId: UserId): Promise<boolean> {
    // Se sube por la cadena `managed_by` del usuario; `union` (sin `all`) corta cualquier ciclo.
    const result = await this.transactions.current().query<{ found: boolean }>(
      `with recursive chain(id, managed_by) as (
         select id, managed_by from users where id = $2
         union
         select u.id, u.managed_by from users u join chain c on u.id = c.managed_by
       )
       select exists(select 1 from chain where managed_by = $1) as found`,
      [managerId, userId],
    );
    return result.rows[0]?.found ?? false;
  }

  async hasReports(userId: UserId): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query("select 1 from users where managed_by = $1 and status <> 'deactivated' limit 1", [
        userId,
      ]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async lockHierarchy(): Promise<void> {
    await this.transactions
      .current()
      .query(
        "select pg_advisory_xact_lock(hashtextextended('hierarchy:' || current_setting('app.org_id', true), 0))",
      );
  }

  async setRank(id: UserId, rank: Rank): Promise<void> {
    await this.transactions.current().query('update users set rank = $2 where id = $1', [id, rank]);
  }

  async setManager(id: UserId, managerId: UserId): Promise<void> {
    await this.transactions
      .current()
      .query('update users set managed_by = $2 where id = $1', [id, managerId]);
  }

  async reassignReports(fromManagerId: UserId, toManagerId: UserId): Promise<number> {
    const result = await this.transactions
      .current()
      .query("update users set managed_by = $2 where managed_by = $1 and status <> 'deactivated'", [
        fromManagerId,
        toManagerId,
      ]);
    return result.rowCount ?? 0;
  }

  async countActiveByRank(rank: Rank): Promise<number> {
    const result = await this.transactions
      .current()
      .query<{ total: string }>(
        "select count(*) as total from users where rank = $1 and status = 'active'",
        [rank],
      );
    // `count` llega como texto (bigint): se convierte de forma explícita.
    return Number(result.rows[0]?.total ?? 0);
  }

  async listAdministratorContacts(): Promise<
    readonly { readonly email: string; readonly locale: 'es-MX' | 'en-US' }[]
  > {
    const result = await this.transactions.current().query<{
      email: string;
      locale: 'es-MX' | 'en-US';
    }>("select email, locale from users where rank = 1 and status = 'active' order by email");
    return result.rows;
  }

  async listRootContacts(): Promise<
    readonly {
      readonly id: UserId;
      readonly email: string;
      readonly locale: 'es-MX' | 'en-US';
    }[]
  > {
    const result = await this.transactions.current().query<{
      id: string;
      email: string;
      locale: 'es-MX' | 'en-US';
    }>("select id, email, locale from users where rank = 0 and status = 'active' order by email");
    return result.rows.map((row) => ({
      id: asUserId(row.id),
      email: row.email,
      locale: row.locale,
    }));
  }

  async list(query: DirectoryQuery): Promise<DirectoryPage> {
    const page = await this.page(query, { where: "status = 'active'", params: [] });
    return { rows: page.rows.map(toDirectoryRow), nextCursor: page.nextCursor };
  }

  async listManaged(
    actor: { readonly id: UserId; readonly isRoot: boolean },
    query: DirectoryQuery,
  ): Promise<ManagedPage> {
    // Subárbol descendente (`union` sin `all` corta cualquier ciclo). La Raíz ve toda la organización.
    const scope = actor.isRoot
      ? { where: 'id <> $1', params: [actor.id] }
      : {
          where: `id in (
            with recursive subtree(id) as (
              select id from users where managed_by = $1
              union
              select u.id from users u join subtree s on u.managed_by = s.id
            ) select id from subtree)`,
          params: [actor.id],
        };
    const page = await this.page(query, scope);
    return {
      rows: page.rows.map((row): ManagedRow => ({
        ...toDirectoryRow(row),
        status: row.status,
        managedBy: toRecord(row).managedBy,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Paginación por cursor común; `scope.where` es SQL fijo del repositorio, nunca texto del cliente. */
  private async page(
    query: DirectoryQuery,
    scope: { readonly where: string; readonly params: readonly unknown[] },
  ): Promise<{ rows: UserRow[]; nextCursor: string | null }> {
    const column = SORT_COLUMN[query.sort];
    const asc = query.dir === 'asc';
    const params: unknown[] = [...scope.params];
    const where: string[] = [scope.where];

    if (query.search !== null) {
      params.push(`%${escapeLike(query.search)}%`);
      where.push(
        `(display_name ilike $${String(params.length)} or email ilike $${String(params.length)})`,
      );
    }
    const cursor = query.cursor === null ? null : decodeCursor(query.cursor, query.sort);
    if (cursor !== null) {
      params.push(cursor.value, cursor.id);
      const a = `$${String(params.length - 1)}`;
      const b = `$${String(params.length)}`;
      where.push(
        `(${column}, id) ${asc ? '>' : '<'} (${query.sort === 'rank' ? `${a}::smallint` : a}, ${b}::uuid)`,
      );
    }
    params.push(query.limit + 1);
    const direction = asc ? 'asc' : 'desc';
    const result = await this.transactions.current().query<UserRow>(
      `select ${USER_COLUMNS}
         from users
        where ${where.join(' and ')}
        order by ${column} ${direction}, id ${direction}
        limit $${String(params.length)}`,
      params,
    );
    const hasMore = result.rows.length > query.limit;
    const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor(query.sort, sortValue(last, query.sort), last.id)
          : null,
    };
  }
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

function sortValue(row: UserRow, field: DirectoryQuery['sort']): string {
  if (field === 'rank') return String(row.rank);
  return field === 'email' ? row.email : row.display_name;
}

/**
 * Cursor opaco: campo de orden, valor y id en base64url. Solo mueve la ventana, no da acceso. Se
 * valida por completo: un cursor manipulado, ilegible o de otro campo de orden se ignora y la
 * consulta devuelve la primera página (nunca un error de base de datos).
 */
function encodeCursor(sort: DirectoryQuery['sort'], value: string, id: string): string {
  return Buffer.from(JSON.stringify([sort, value, id])).toString('base64url');
}

function decodeCursor(
  cursor: string,
  sort: DirectoryQuery['sort'],
): { value: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [field, value, id] = parsed as unknown[];
    if (field !== sort || typeof value !== 'string' || typeof id !== 'string') return null;
    if (!z.uuid().safeParse(id).success) return null;
    if (sort === 'rank' && !/^[0-3]$/.test(value)) return null;
    // PostgreSQL rechaza el carácter NUL en texto (error de base de datos): ningún control entra.
    if (value.length > 300 || hasControlCharacter(value)) return null;
    return { value, id };
  } catch {
    return null;
  }
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: asUserId(row.id),
    organizationId: asOrganizationId(row.organization_id),
    email: row.email,
    displayName: row.display_name,
    rank: toRank(row.rank),
    status: row.status,
    managedBy: row.managed_by === null ? null : asUserId(row.managed_by),
    createdBy: row.created_by === null ? null : asUserId(row.created_by),
    locale: row.locale,
    timezone: row.timezone,
  };
}

function toDirectoryRow(row: UserRow): DirectoryRow {
  const { id, displayName, email, rank } = toRecord(row);
  return { id, displayName, email, rank };
}

function toRank(value: number): Rank {
  if (!isRank(value)) throw new Error(`Unexpected rank in database: ${String(value)}`);
  return value;
}
