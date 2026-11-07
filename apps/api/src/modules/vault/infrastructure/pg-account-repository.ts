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
  AccountListEntry,
  AccountListFilters,
  AccountRecord,
  AccountRepository,
  ExistingAccountKey,
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
  last_changed_at: Date | null;
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

const toListEntry = (row: ListedAccountRow): AccountListEntry => ({
  ...toRecord(row),
  myLevel: row.my_level,
  lastChangedAt: row.last_changed_at,
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

  async listVisiblePage(
    userId: UserId,
    page: KeysetRequest,
    filters: AccountListFilters,
  ): Promise<KeysetPage<AccountListEntry>> {
    const params: unknown[] = [userId];
    // El acceso efectivo es parte de la consulta, no un paso posterior: una cuenta ajena nunca sale de SQL.
    const accessJoin = `join effective_access ea
           on ea.organization_id = a.organization_id
          and ea.resource_type = 'account'
          and ea.resource_id = a.id
          and ea.user_id = $1`;
    return this.listPage(
      { params, accessJoin, myLevelColumn: 'ea.level', includeCredentialPosture: true },
      page,
      filters,
    );
  }

  async findVisibleKeysByNames(
    userId: UserId,
    displayNames: readonly string[],
  ): Promise<readonly ExistingAccountKey[]> {
    if (displayNames.length === 0) return [];
    const result = await this.transactions
      .current()
      .query<{ platform_id: string; display_name: string }>(
        `select a.platform_id, a.display_name
           from accounts a
           join effective_access ea
             on ea.organization_id = a.organization_id
            and ea.resource_type = 'account'
            and ea.resource_id = a.id
            and ea.user_id = $1
          where a.status = 'active'
            and lower(a.display_name) = any($2::text[])`,
        [userId, displayNames.map((name) => name.toLowerCase())],
      );
    return result.rows.map((row) => ({
      platformId: row.platform_id,
      displayName: row.display_name,
    }));
  }

  async listVisibleTags(userId: UserId): Promise<readonly string[]> {
    // Misma unión con el acceso efectivo que el listado: una cuenta ajena no aporta etiquetas.
    return this.listTags(
      `join effective_access ea
          on ea.organization_id = a.organization_id
         and ea.resource_type = 'account'
         and ea.resource_id = a.id
         and ea.user_id = $1`,
      [userId],
    );
  }

  async listInventoryTags(): Promise<readonly string[]> {
    return this.listTags('', []);
  }

  /** Etiquetas distintas de las cuentas activas que deja pasar `accessJoin`, con un tope de seguridad. */
  private async listTags(accessJoin: string, params: unknown[]): Promise<readonly string[]> {
    const result = await this.transactions.current().query<{ tag: string }>(
      `select tag
         from (select distinct unnest(a.tags) as tag
                 from accounts a
                 ${accessJoin}
                where a.status = 'active') tags
        order by lower(tag), tag
        limit ${String(MAX_LISTED_TAGS)}`,
      params,
    );
    return result.rows.map((row) => row.tag);
  }

  async listInventoryPage(
    page: KeysetRequest,
    filters: AccountListFilters,
  ): Promise<KeysetPage<AccountListEntry>> {
    // El inventario no concede acceso: sin unión con `effective_access` y sin nivel. Tampoco toca las
    // credenciales: quien lo lee no accede a las cuentas, así que no se le revela su antigüedad ni su 2FA.
    return this.listPage(
      { params: [], accessJoin: '', myLevelColumn: 'null::text', includeCredentialPosture: false },
      page,
      filters,
    );
  }

  /**
   * Listado común de cuentas activas: orden fijo por nombre, cursor, búsqueda de texto y filtro rápido.
   * Todo valor del usuario viaja como parámetro enlazado; el texto se escapa antes de armar el patrón.
   */
  private async listPage(
    base: {
      readonly params: unknown[];
      readonly accessJoin: string;
      readonly myLevelColumn: string;
      /** Falso en el inventario: sin unión con credenciales y sin filtros que dependan de ellas. */
      readonly includeCredentialPosture: boolean;
    },
    page: KeysetRequest,
    filters: AccountListFilters,
  ): Promise<KeysetPage<AccountListEntry>> {
    const params = base.params;
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${String(params.length)}`;
    };

    const clauses: string[] = [];
    const after = decodeKeysetCursor(page.cursor, [isPlainTextPart, isUuidPart]);
    if (after !== null) {
      const namePlaceholder = bind(after[0]);
      const idPlaceholder = bind(after[1]);
      clauses.push(
        `(lower(a.display_name), a.id) > (${namePlaceholder}::text, ${idPlaceholder}::uuid)`,
      );
    }
    if (filters.text !== null) {
      const pattern = bind(`%${escapeLikePattern(filters.text)}%`);
      clauses.push(
        `(a.display_name ilike ${pattern} escape '\\'
          or a.handle ilike ${pattern} escape '\\'
          or exists (select 1 from platforms p
                      where p.id = a.platform_id and p.name ilike ${pattern} escape '\\')
          or exists (select 1 from unnest(a.tags) as tag where tag ilike ${pattern} escape '\\')
          or exists (select 1 from groups g
                      where g.id = a.owner_group_id and g.archived_at is null
                        and g.name ilike ${pattern} escape '\\'))`,
      );
    }
    if (filters.tag !== null) {
      clauses.push(`${bind(filters.tag)}::text = any(a.tags)`);
    }
    if (filters.quickFilter !== null && !base.includeCredentialPosture) {
      // Defensa en profundidad: la capa de aplicación ya no pasa filtros rápidos al inventario.
      throw new Error('Quick filters need credential data, which this listing must not read');
    }
    if (filters.quickFilter === 'review') {
      // Amarillo y rojo: la credencial más antigua pasó el umbral de «más de 60 días».
      clauses.push(`lc.last_changed_at < ${bind(filters.agingCutoff)}::timestamptz`);
    } else if (filters.quickFilter === 'no-2fa') {
      // Cuenta de una plataforma con segundo factor cuya credencial vigente no tiene un TOTP confirmado.
      clauses.push(
        `exists (select 1
                   from credentials c
                   join platforms p on p.id = a.platform_id and p.supports_totp
                  where c.account_id = a.id and c.archived_at is null
                    and not exists (select 1 from credential_totp t
                                     where t.credential_id = c.id and t.status = 'verified'))`,
      );
    }
    const extraConditions = clauses.map((clause) => `and ${clause}`).join('\n          ');
    const limitPlaceholder = bind(page.limit + 1);
    const lastChangedColumn = base.includeCredentialPosture
      ? 'lc.last_changed_at'
      : 'null::timestamptz as last_changed_at';
    const credentialJoin = base.includeCredentialPosture
      ? `left join lateral (
           select min(coalesce(c.last_rotated_at, c.created_at)) as last_changed_at
             from credentials c
            where c.account_id = a.id and c.archived_at is null
         ) lc on true`
      : '';

    const result = await this.transactions.current().query<ListedAccountRow>(
      `select ${ACCOUNT_COLUMNS}, ${base.myLevelColumn} as my_level,
              lower(a.display_name) as sort_name, ${lastChangedColumn}
         from accounts a
         ${base.accessJoin}
         ${credentialJoin}
        where a.status = 'active'
          ${extraConditions}
        order by lower(a.display_name), a.id
        limit ${limitPlaceholder}`,
      params,
    );
    const keyset = toKeysetPage(result.rows, page.limit, (row) => [row.sort_name, row.id]);
    return { rows: keyset.rows.map(toListEntry), nextCursor: keyset.nextCursor };
  }
}

/** Tope de etiquetas sugeridas: evita respuestas enormes si una organización abusa de ellas. */
const MAX_LISTED_TAGS = 500;

/** Escapa los comodines de `LIKE` para que el texto buscado se compare tal cual, sin patrones. */
function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Expected the statement to return a row');
  return row;
}
