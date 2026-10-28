/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita cuentas, comparticiones y grupos a la organización.
 * - El acceso se calcula siempre en SQL con la vista `effective_access` (migración 0007), que ignora
 *   comparticiones revocadas o vencidas y grupos archivados. Nunca se filtra en memoria.
 * - Las consultas llevan parámetros enlazados; los cursores se validan antes de llegar aquí.
 */
import type { ShareLevel } from '@iam/contracts';

import {
  decodeKeysetCursor,
  isPlainTextPart,
  isUuidPart,
  toKeysetPage,
} from '../../../shared/kernel/index.js';
import type { KeysetPage, KeysetRequest, UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  AccountEdit,
  AccountRecord,
  AccountRepository,
  AccountView,
  NewAccount,
  PlatformRecord,
} from '../application/ports/account-repository.js';

interface AccountRow {
  id: string;
  platform_id: string;
  display_name: string;
  handle: string | null;
  owner_group_id: string | null;
  tags: string[];
  status: 'active' | 'archived';
  created_by: string;
  created_at: Date;
}

interface ListedAccountRow extends AccountRow {
  my_level: ShareLevel | null;
  sort_name: string;
}

interface PlatformRow {
  id: string;
  name: string;
  slug: string;
  login_url: string | null;
  supports_totp: boolean;
  organization_id: string | null;
}

const ACCOUNT_COLUMNS = `a.id, a.platform_id, a.display_name, a.handle, a.owner_group_id, a.tags,
       a.status, a.created_by, a.created_at`;

const toRecord = (row: AccountRow): AccountRecord => ({
  id: row.id,
  platformId: row.platform_id,
  displayName: row.display_name,
  handle: row.handle,
  ownerGroupId: row.owner_group_id,
  tags: row.tags,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const toView = (row: ListedAccountRow): AccountView => ({
  ...toRecord(row),
  myLevel: row.my_level,
});

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async listPlatforms(): Promise<readonly PlatformRecord[]> {
    const result = await this.transactions.current().query<PlatformRow>(
      `select id, name, slug, login_url, supports_totp, organization_id
         from platforms
        where archived_at is null
        order by lower(name), id`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      loginUrl: row.login_url,
      supportsTotp: row.supports_totp,
      isGlobal: row.organization_id === null,
    }));
  }

  async platformIsUsable(platformId: string): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query('select 1 from platforms where id = $1 and archived_at is null', [platformId]);
    return result.rows.length > 0;
  }

  async groupIsLive(groupId: string): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query('select 1 from groups where id = $1 and archived_at is null', [groupId]);
    return result.rows.length > 0;
  }

  async insert(account: NewAccount): Promise<AccountRecord> {
    const result = await this.transactions.current().query<AccountRow>(
      `insert into accounts (id, organization_id, platform_id, display_name, handle, owner_group_id, tags, created_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, $3, $4, $5, $6, $7)
       returning id, platform_id, display_name, handle, owner_group_id, tags, status, created_by, created_at`,
      [
        account.id,
        account.platformId,
        account.displayName,
        account.handle,
        account.ownerGroupId,
        [...account.tags],
        account.createdBy,
      ],
    );
    return toRecord(requireRow(result.rows[0]));
  }

  async insertUserShare(input: {
    readonly id: string;
    readonly accountId: string;
    readonly userId: UserId;
    readonly level: ShareLevel;
    readonly grantedBy: UserId;
  }): Promise<void> {
    await this.transactions.current().query(
      `insert into shares (id, organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, 'account', $2, 'user', $3, $4, $5)`,
      [input.id, input.accountId, input.userId, input.level, input.grantedBy],
    );
  }

  async findById(accountId: string): Promise<AccountRecord | null> {
    const result = await this.transactions
      .current()
      .query<AccountRow>(`select ${ACCOUNT_COLUMNS} from accounts a where a.id = $1`, [accountId]);
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findByIdForUpdate(accountId: string): Promise<AccountRecord | null> {
    const result = await this.transactions
      .current()
      .query<AccountRow>(`select ${ACCOUNT_COLUMNS} from accounts a where a.id = $1 for update`, [
        accountId,
      ]);
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async effectiveLevel(accountId: string, userId: UserId): Promise<ShareLevel | null> {
    const result = await this.transactions.current().query<{ level: ShareLevel }>(
      `select level
         from effective_access
        where resource_type = 'account' and resource_id = $1 and user_id = $2`,
      [accountId, userId],
    );
    return result.rows[0]?.level ?? null;
  }

  async update(accountId: string, edit: AccountEdit): Promise<AccountRecord> {
    const result = await this.transactions.current().query<AccountRow>(
      `update accounts
          set display_name = $2, handle = $3, owner_group_id = $4, tags = $5
        where id = $1
        returning id, platform_id, display_name, handle, owner_group_id, tags, status, created_by, created_at`,
      [accountId, edit.displayName, edit.handle, edit.ownerGroupId, [...edit.tags]],
    );
    return toRecord(requireRow(result.rows[0]));
  }

  async archive(input: {
    readonly accountId: string;
    readonly at: Date;
    readonly revokedBy: UserId;
  }): Promise<{ readonly revokedShares: number }> {
    const executor = this.transactions.current();
    await executor.query(
      "update accounts set status = 'archived', archived_at = $2 where id = $1 and status = 'active'",
      [input.accountId, input.at],
    );
    // Se conserva la fila de la compartición con su fecha: quién tuvo acceso y cuándo es dato forense.
    const revoked = await executor.query(
      `update shares
          set revoked_at = $2, revoked_by = $3
        where resource_type = 'account' and resource_id = $1 and revoked_at is null`,
      [input.accountId, input.at, input.revokedBy],
    );
    return { revokedShares: revoked.rowCount ?? 0 };
  }

  async listVisiblePage(userId: UserId, page: KeysetRequest): Promise<KeysetPage<AccountView>> {
    const params: unknown[] = [userId];
    const after = decodeKeysetCursor(page.cursor, [isPlainTextPart, isUuidPart]);
    let afterClause = '';
    if (after !== null) {
      params.push(after[0], after[1]);
      afterClause = 'and (lower(a.display_name), a.id) > ($2::text, $3::uuid)';
    }
    params.push(page.limit + 1);
    const result = await this.transactions.current().query<ListedAccountRow>(
      `select ${ACCOUNT_COLUMNS}, ea.level as my_level, lower(a.display_name) as sort_name
         from accounts a
         join effective_access ea
           on ea.organization_id = a.organization_id
          and ea.resource_type = 'account'
          and ea.resource_id = a.id
          and ea.user_id = $1
        where a.status = 'active' ${afterClause}
        order by lower(a.display_name), a.id
        limit $${String(params.length)}`,
      params,
    );
    return this.toPage(result.rows, page.limit);
  }

  async listInventoryPage(page: KeysetRequest): Promise<KeysetPage<AccountView>> {
    const params: unknown[] = [];
    const after = decodeKeysetCursor(page.cursor, [isPlainTextPart, isUuidPart]);
    let afterClause = '';
    if (after !== null) {
      params.push(after[0], after[1]);
      afterClause = 'and (lower(a.display_name), a.id) > ($1::text, $2::uuid)';
    }
    params.push(page.limit + 1);
    const result = await this.transactions.current().query<ListedAccountRow>(
      `select ${ACCOUNT_COLUMNS}, null::text as my_level, lower(a.display_name) as sort_name
         from accounts a
        where a.status = 'active' ${afterClause}
        order by lower(a.display_name), a.id
        limit $${String(params.length)}`,
      params,
    );
    return this.toPage(result.rows, page.limit);
  }

  private toPage(rows: readonly ListedAccountRow[], limit: number): KeysetPage<AccountView> {
    const keyset = toKeysetPage(rows, limit, (row) => [row.sort_name, row.id]);
    return { rows: keyset.rows.map(toView), nextCursor: keyset.nextCursor };
  }
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Expected the statement to return a row');
  return row;
}
