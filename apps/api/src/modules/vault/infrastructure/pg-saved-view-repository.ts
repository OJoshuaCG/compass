/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización.
 * - Aislamiento por persona en el SQL: cada consulta filtra por `user_id`; nadie ve ni borra vistas ajenas.
 */
import type { AccountListFilter } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  NewSavedView,
  SavedViewRecord,
  SavedViewRepository,
} from '../application/ports/saved-view-repository.js';

interface Row {
  id: string;
  name: string;
  search_text: string | null;
  quick_filter: AccountListFilter | null;
  created_at: Date;
}

const UNIQUE_VIOLATION = '23505';

const toRecord = (row: Row): SavedViewRecord => ({
  id: row.id,
  name: row.name,
  searchText: row.search_text,
  quickFilter: row.quick_filter,
  createdAt: row.created_at,
});

export class PgSavedViewRepository implements SavedViewRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async lockUser(userId: UserId): Promise<void> {
    await this.transactions
      .current()
      .query(
        "select pg_advisory_xact_lock(hashtextextended('saved-view:' || current_setting('app.org_id', true) || ':' || $1::text, 0))",
        [userId],
      );
  }

  async listByUser(userId: UserId): Promise<readonly SavedViewRecord[]> {
    const result = await this.transactions.current().query<Row>(
      `select id, name, search_text, quick_filter, created_at
         from saved_account_views
        where user_id = $1
        order by lower(name), id`,
      [userId],
    );
    return result.rows.map(toRecord);
  }

  async countByUser(userId: UserId): Promise<number> {
    const result = await this.transactions
      .current()
      .query<{ total: string }>(
        `select count(*)::text as total from saved_account_views where user_id = $1`,
        [userId],
      );
    return Number(result.rows[0]?.total ?? '0');
  }

  async insert(view: NewSavedView): Promise<boolean> {
    const client = this.transactions.current();
    // Savepoint: la violación de unicidad no debe dejar abortada la transacción del caso de uso.
    await client.query('savepoint saved_view_insert');
    try {
      await client.query(
        `insert into saved_account_views (id, organization_id, user_id, name, search_text, quick_filter)
         values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, $3, $4, $5)`,
        [view.id, view.userId, view.name, view.searchText, view.quickFilter],
      );
      await client.query('release savepoint saved_view_insert');
      return true;
    } catch (error) {
      await client.query('rollback to savepoint saved_view_insert');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return false;
      throw error;
    }
  }

  async deleteOwned(userId: UserId, viewId: string): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query(`delete from saved_account_views where id = $1 and user_id = $2`, [viewId, userId]);
    return (result.rowCount ?? 0) > 0;
  }
}
