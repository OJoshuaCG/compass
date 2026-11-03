/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita comparticiones, vistas y grupos a la organización.
 * - Las comparticiones no se borran: revocar marca `revoked_at` y `revoked_by`.
 * - Las consultas llevan parámetros enlazados; ningún valor se compone en el SQL.
 */
import type { ShareGranteeType, ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  InboundViewShareRepository,
  NewViewShare,
  ShareableView,
  ViewShareRecord,
  ViewShareView,
} from '../application/ports/inbound-view-share-repository.js';

interface ShareRow {
  id: string;
  view_id: string;
  grantee_type: ShareGranteeType;
  grantee_id: string;
  level: ShareLevel;
  expires_at: Date | null;
  granted_by: string;
  created_at: Date;
}

interface ShareViewRow extends ShareRow {
  grantee_name: string;
}

const SHARE_COLUMNS = `s.id, s.resource_id as view_id, s.grantee_type, s.grantee_id, s.level,
       s.expires_at, s.granted_by, s.created_at`;

const VIEW_COLUMNS = `${SHARE_COLUMNS}, coalesce(u.display_name, g.name) as grantee_name`;

const VIEW_JOINS = `left join users u on s.grantee_type = 'user' and u.id = s.grantee_id
       left join groups g on s.grantee_type = 'group' and g.id = s.grantee_id`;

const toRecord = (row: ShareRow): ViewShareRecord => ({
  id: row.id,
  viewId: row.view_id,
  granteeType: row.grantee_type,
  granteeId: row.grantee_id,
  level: row.level,
  expiresAt: row.expires_at,
  grantedBy: row.granted_by,
  createdAt: row.created_at,
});

const toView = (row: ShareViewRow): ViewShareView => ({
  ...toRecord(row),
  granteeName: row.grantee_name,
});

interface ViewRow {
  id: string;
  source_id: string;
  account_id: string | null;
}

const toShareableView = (row: ViewRow): ShareableView => ({
  id: row.id,
  sourceId: row.source_id,
  accountId: row.account_id,
});

export class PgInboundViewShareRepository implements InboundViewShareRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async findView(viewId: string): Promise<ShareableView | null> {
    return this.selectView(viewId, '');
  }

  async findViewForUpdate(viewId: string): Promise<ShareableView | null> {
    // También se bloquea la fuente: así `account_id` no cambia entre leerlo y decidir con él.
    return this.selectView(viewId, 'for update of v, s');
  }

  async viewLevel(viewId: string, userId: UserId): Promise<ShareLevel | null> {
    return this.levelOf('mail_view', viewId, userId);
  }

  async lockAccountForShare(accountId: string): Promise<void> {
    await this.transactions
      .current()
      .query('select 1 from accounts where id = $1 for share', [accountId]);
  }

  async lockAccountForRotation(accountId: string): Promise<void> {
    await this.transactions
      .current()
      .query('select 1 from accounts where id = $1 for update', [accountId]);
  }

  async accountLevel(accountId: string, userId: UserId): Promise<ShareLevel | null> {
    return this.levelOf('account', accountId, userId);
  }

  async listLive(viewId: string, now: Date): Promise<readonly ViewShareView[]> {
    const result = await this.transactions.current().query<ShareViewRow>(
      `select ${VIEW_COLUMNS}
         from shares s
         ${VIEW_JOINS}
        where s.resource_type = 'mail_view'
          and s.resource_id = $1
          and s.revoked_at is null
          and (s.expires_at is null or s.expires_at > $2)
        order by s.created_at, s.id`,
      [viewId, now],
    );
    return result.rows.map(toView);
  }

  async findViewShareById(viewId: string, shareId: string): Promise<ViewShareView | null> {
    const result = await this.transactions.current().query<ShareViewRow>(
      `select ${VIEW_COLUMNS}
         from shares s
         ${VIEW_JOINS}
        where s.resource_type = 'mail_view' and s.resource_id = $1 and s.id = $2`,
      [viewId, shareId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toView(row);
  }

  async findOpenByGrantee(
    viewId: string,
    granteeType: ShareGranteeType,
    granteeId: string,
  ): Promise<ViewShareRecord | null> {
    const result = await this.transactions.current().query<ShareRow>(
      `select ${SHARE_COLUMNS}
         from shares s
        where s.resource_type = 'mail_view'
          and s.resource_id = $1
          and s.grantee_type = $2
          and s.grantee_id = $3
          and s.revoked_at is null`,
      [viewId, granteeType, granteeId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findOpenById(viewId: string, shareId: string): Promise<ViewShareRecord | null> {
    const result = await this.transactions.current().query<ShareRow>(
      `select ${SHARE_COLUMNS}
         from shares s
        where s.resource_type = 'mail_view'
          and s.resource_id = $1
          and s.id = $2
          and s.revoked_at is null`,
      [viewId, shareId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async insert(share: NewViewShare): Promise<void> {
    await this.transactions.current().query(
      `insert into shares (id, organization_id, resource_type, resource_id, grantee_type, grantee_id, level, expires_at, granted_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, 'mail_view', $2, $3, $4, $5, $6, $7)`,
      [
        share.id,
        share.viewId,
        share.granteeType,
        share.granteeId,
        share.level,
        share.expiresAt,
        share.grantedBy,
      ],
    );
  }

  async revoke(shareId: string, at: Date, revokedBy: UserId): Promise<void> {
    await this.transactions
      .current()
      .query(
        'update shares set revoked_at = $2, revoked_by = $3 where id = $1 and revoked_at is null',
        [shareId, at, revokedBy],
      );
  }

  async userIsActive(userId: string): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query("select 1 from users where id = $1 and status = 'active'", [userId]);
    return result.rows.length > 0;
  }

  async groupIsLive(groupId: string): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query('select 1 from groups where id = $1 and archived_at is null', [groupId]);
    return result.rows.length > 0;
  }

  async groupMemberIds(groupId: string): Promise<readonly string[]> {
    const result = await this.transactions
      .current()
      .query<{ user_id: string }>('select user_id from group_memberships where group_id = $1', [
        groupId,
      ]);
    return result.rows.map((row) => row.user_id);
  }

  async usersWhoRevealedResets(
    viewId: string,
    userIds: readonly string[],
    since: Date,
  ): Promise<readonly string[]> {
    if (userIds.length === 0) return [];
    // La revelación audita un evento por elemento con la vista en los metadatos; un intento sin nada
    // vigente apunta a la vista (`mail_view`) y no reveló nada, así que no cuenta. Tampoco los fallos.
    const result = await this.transactions.current().query<{ actor_id: string }>(
      `select distinct ae.actor_id
         from audit_events ae
        where ae.action = 'inbound.reset_revealed'
          and ae.outcome = 'success'
          and ae.target_type = 'inbound_item'
          and ae.metadata ->> 'viewId' = $1
          and ae.actor_id = any($2::uuid[])
          and ae.created_at > $3
        order by ae.actor_id`,
      [viewId, [...userIds], since],
    );
    return result.rows.map((row) => row.actor_id);
  }

  async liveCredentialIds(accountId: string): Promise<readonly string[]> {
    const result = await this.transactions.current().query<{ id: string }>(
      `select c.id
         from credentials c
        where c.account_id = $1
          and c.archived_at is null
        order by c.id`,
      [accountId],
    );
    return result.rows.map((row) => row.id);
  }

  private async selectView(viewId: string, lockClause: string): Promise<ShareableView | null> {
    const result = await this.transactions.current().query<ViewRow>(
      `select v.id, v.source_id, s.account_id
         from mail_views v
         join mail_sources s
           on s.organization_id = v.organization_id and s.id = v.source_id
        where v.id = $1
          and v.archived_at is null
          and s.status <> 'archived'
        ${lockClause}`,
      [viewId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toShareableView(row);
  }

  private async levelOf(
    resourceType: 'mail_view' | 'account',
    resourceId: string,
    userId: UserId,
  ): Promise<ShareLevel | null> {
    const result = await this.transactions.current().query<{ level: ShareLevel }>(
      `select level
         from effective_access
        where resource_type = $1 and resource_id = $2 and user_id = $3`,
      [resourceType, resourceId, userId],
    );
    return result.rows[0]?.level ?? null;
  }
}
