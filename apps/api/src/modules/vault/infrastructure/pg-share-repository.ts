/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita comparticiones, grupos y tareas a la organización.
 * - Las comparticiones no se borran: revocar marca `revoked_at` y `revoked_by`.
 * - Las consultas llevan parámetros enlazados; ningún valor se compone en el SQL.
 */
import type { ShareGranteeType, ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  NewRotationTask,
  NewShare,
  RevealedCredential,
  ShareRecord,
  ShareRepository,
  ShareView,
} from '../application/ports/share-repository.js';

interface ShareRow {
  id: string;
  account_id: string;
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

const SHARE_COLUMNS = `s.id, s.resource_id as account_id, s.grantee_type, s.grantee_id, s.level,
       s.expires_at, s.granted_by, s.created_at`;

const VIEW_COLUMNS = `${SHARE_COLUMNS}, coalesce(u.display_name, g.name) as grantee_name`;

const VIEW_JOINS = `left join users u on s.grantee_type = 'user' and u.id = s.grantee_id
       left join groups g on s.grantee_type = 'group' and g.id = s.grantee_id`;

const toRecord = (row: ShareRow): ShareRecord => ({
  id: row.id,
  accountId: row.account_id,
  granteeType: row.grantee_type,
  granteeId: row.grantee_id,
  level: row.level,
  expiresAt: row.expires_at,
  grantedBy: row.granted_by,
  createdAt: row.created_at,
});

const toView = (row: ShareViewRow): ShareView => ({
  ...toRecord(row),
  granteeName: row.grantee_name,
});

/** Disparador de la tarea de rotación que crea una compartición revocada (migración 0006). */
const ROTATION_TRIGGER_SHARE_REVOKED = 'share_revoked';
const ROTATION_PRIORITY_HIGH = 'high';

export class PgShareRepository implements ShareRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async listLive(accountId: string, now: Date): Promise<readonly ShareView[]> {
    const result = await this.transactions.current().query<ShareViewRow>(
      `select ${VIEW_COLUMNS}
         from shares s
         ${VIEW_JOINS}
        where s.resource_type = 'account'
          and s.resource_id = $1
          and s.revoked_at is null
          and (s.expires_at is null or s.expires_at > $2)
        order by s.created_at, s.id`,
      [accountId, now],
    );
    return result.rows.map(toView);
  }

  async findViewById(accountId: string, shareId: string): Promise<ShareView | null> {
    const result = await this.transactions.current().query<ShareViewRow>(
      `select ${VIEW_COLUMNS}
         from shares s
         ${VIEW_JOINS}
        where s.resource_type = 'account' and s.resource_id = $1 and s.id = $2`,
      [accountId, shareId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toView(row);
  }

  async findOpenByGrantee(
    accountId: string,
    granteeType: ShareGranteeType,
    granteeId: string,
  ): Promise<ShareRecord | null> {
    const result = await this.transactions.current().query<ShareRow>(
      `select ${SHARE_COLUMNS}
         from shares s
        where s.resource_type = 'account'
          and s.resource_id = $1
          and s.grantee_type = $2
          and s.grantee_id = $3
          and s.revoked_at is null`,
      [accountId, granteeType, granteeId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findOpenById(accountId: string, shareId: string): Promise<ShareRecord | null> {
    const result = await this.transactions.current().query<ShareRow>(
      `select ${SHARE_COLUMNS}
         from shares s
        where s.resource_type = 'account'
          and s.resource_id = $1
          and s.id = $2
          and s.revoked_at is null`,
      [accountId, shareId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async insert(share: NewShare): Promise<void> {
    await this.transactions.current().query(
      `insert into shares (id, organization_id, resource_type, resource_id, grantee_type, grantee_id, level, expires_at, granted_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, 'account', $2, $3, $4, $5, $6, $7)`,
      [
        share.id,
        share.accountId,
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

  async groupMemberIds(groupId: string): Promise<readonly string[]> {
    const result = await this.transactions
      .current()
      .query<{ user_id: string }>('select user_id from group_memberships where group_id = $1', [
        groupId,
      ]);
    return result.rows.map((row) => row.user_id);
  }

  async revealedCredentials(
    accountId: string,
    userIds: readonly string[],
    since: Date,
  ): Promise<readonly RevealedCredential[]> {
    if (userIds.length === 0) return [];
    const result = await this.transactions.current().query<{
      actor_id: string;
      credential_id: string;
    }>(
      `select distinct ae.actor_id, ae.target_id as credential_id
         from audit_events ae
         join credentials c on c.id = ae.target_id and c.account_id = $1
        -- Una credencial archivada ya no se puede revelar: rotarla no protege nada.
        where c.archived_at is null
          and ae.action = 'credential.revealed'
          and ae.outcome = 'success'
          and ae.target_type = 'credential'
          and ae.actor_id = any($2::uuid[])
          and ae.created_at > $3
        order by ae.target_id, ae.actor_id`,
      [accountId, [...userIds], since],
    );
    return result.rows.map((row) => ({ userId: row.actor_id, credentialId: row.credential_id }));
  }

  async openRotationTaskExists(credentialId: string): Promise<boolean> {
    const result = await this.transactions.current().query(
      `select 1
         from rotation_tasks
        where credential_id = $1
          and trigger = $2
          and status in ('pending', 'in_progress')`,
      [credentialId, ROTATION_TRIGGER_SHARE_REVOKED],
    );
    return result.rows.length > 0;
  }

  async insertRotationTask(task: NewRotationTask): Promise<void> {
    await this.transactions.current().query(
      `insert into rotation_tasks
         (organization_id, credential_id, trigger, triggered_by_user, assigned_to, priority, due_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)`,
      [
        task.credentialId,
        ROTATION_TRIGGER_SHARE_REVOKED,
        task.triggeredByUser,
        task.assignedTo,
        ROTATION_PRIORITY_HIGH,
        task.dueAt,
      ],
    );
  }
}
