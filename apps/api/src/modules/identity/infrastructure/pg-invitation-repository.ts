import type { QueryResultRow } from 'pg';

import {
  asOrganizationId,
  asUserId,
  decodeKeysetCursor,
  isRank,
  isTimestampTextPart,
  isUuidPart,
  toKeysetPage,
} from '../../../shared/kernel/index.js';
import type { KeysetPage, KeysetRequest, Rank, UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  PendingInvitationRecord,
  InvitationRecord,
  InvitationRepository,
  NewInvitation,
} from '../application/ports/identity-ports.js';

interface InvitationRow extends QueryResultRow {
  id: string;
  organization_id: string;
  email: string;
  rank: number;
  invited_by: string;
  managed_by: string;
  role_ids: string[];
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

const UNIQUE_VIOLATION = '23505';

export class PgInvitationRepository implements InvitationRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async insert(invitation: NewInvitation): Promise<'inserted' | 'conflict'> {
    const client = this.transactions.current();
    // Savepoint: una invitación pendiente repetida es un resultado esperado, no debe abortar la transacción.
    await client.query('savepoint insert_invitation');
    try {
      await client.query(
        `insert into invitations (id, organization_id, email, rank, invited_by, managed_by, role_ids, token_hash, expires_at)
         values ($1, $2, lower($3), $4, $5, $6, $7::uuid[], $8, $9)`,
        [
          invitation.id,
          invitation.organizationId,
          invitation.email,
          invitation.rank,
          invitation.invitedBy,
          invitation.managedBy,
          invitation.roleIds,
          Buffer.from(invitation.tokenHash),
          invitation.expiresAt,
        ],
      );
      await client.query('release savepoint insert_invitation');
      return 'inserted';
    } catch (error) {
      await client.query('rollback to savepoint insert_invitation');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'conflict';
      throw error;
    }
  }

  async revokeExpiredForEmail(email: string, now: Date): Promise<void> {
    await this.transactions.current().query(
      `update invitations set revoked_at = $2
        where email = lower($1) and accepted_at is null and revoked_at is null and expires_at <= $2`,
      [email, now],
    );
  }

  async listPending(
    invitedBy: UserId | null,
    page: KeysetRequest,
  ): Promise<KeysetPage<PendingInvitationRecord>> {
    const params: unknown[] = [invitedBy];
    let afterCursor = '';
    const after = decodeKeysetCursor(page.cursor, [isTimestampTextPart, isUuidPart]);
    if (after !== null) {
      params.push(after[0], after[1]);
      afterCursor = 'and (created_at, id) < ($2::timestamptz, $3::uuid)';
    }
    params.push(page.limit + 1);
    // La marca de tiempo viaja como texto en el cursor para no perder los microsegundos.
    const result = await this.transactions.current().query<{
      id: string;
      email: string;
      rank: number;
      created_at: Date;
      created_text: string;
      expires_at: Date;
    }>(
      `select id, email, rank, created_at, created_at::text as created_text, expires_at
         from invitations
        where accepted_at is null and revoked_at is null and ($1::uuid is null or invited_by = $1)
          ${afterCursor}
        order by created_at desc, id desc
        limit $${String(params.length)}`,
      params,
    );
    const keyset = toKeysetPage(result.rows, page.limit, (row) => [row.created_text, row.id]);
    return {
      rows: keyset.rows.map((row) => ({
        id: row.id,
        email: row.email,
        rank: toRank(row.rank),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      })),
      nextCursor: keyset.nextCursor,
    };
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update invitations set revoked_at = $2 where id = $1 and revoked_at is null', [
        id,
        at,
      ]);
  }

  /** Revoca las pendientes que la persona dejó (como quien invita o como responsable del invitado). */
  async revokePendingOfUser(userId: UserId, at: Date): Promise<void> {
    await this.transactions.current().query(
      `update invitations set revoked_at = $2
        where (invited_by = $1 or managed_by = $1) and accepted_at is null and revoked_at is null`,
      [userId, at],
    );
  }

  async findByIdForUpdate(id: string): Promise<InvitationRecord | null> {
    const result = await this.transactions.current().query<InvitationRow>(
      `select id, organization_id, email, rank, invited_by, managed_by, role_ids, expires_at, accepted_at, revoked_at
         from invitations where id = $1 for update`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined || !isRank(row.rank) || row.rank === 0) return null;
    return {
      id: row.id,
      organizationId: asOrganizationId(row.organization_id),
      email: row.email,
      rank: row.rank,
      invitedBy: asUserId(row.invited_by),
      managedBy: asUserId(row.managed_by),
      roleIds: row.role_ids,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
    };
  }

  async markAccepted(id: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update invitations set accepted_at = $2 where id = $1 and accepted_at is null', [
        id,
        at,
      ]);
  }
}

function toRank(value: number): Rank {
  if (!isRank(value)) throw new Error(`Unexpected rank in database: ${String(value)}`);
  return value;
}
