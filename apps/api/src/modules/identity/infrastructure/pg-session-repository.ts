/**
 * Invariantes de seguridad
 * - En base de datos solo vive el SHA-256 del token de sesión, nunca el token.
 * - Todo corre en la transacción en curso: RLS limita las sesiones a la organización.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  NewSession,
  SessionListing,
  SessionRepository,
} from '../application/ports/identity-ports.js';

export class PgSessionRepository implements SessionRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async insert(session: NewSession): Promise<void> {
    await this.transactions.current().query(
      `insert into sessions (id, organization_id, user_id, token_hash, ip, user_agent, last_seen_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        session.id,
        session.organizationId,
        session.userId,
        Buffer.from(session.tokenHash),
        session.ip,
        session.userAgent,
        session.createdAt,
        session.expiresAt,
      ],
    );
  }

  async setMfa(sessionId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query(
        'update sessions set mfa_at = $2, last_seen_at = $2 where id = $1 and revoked_at is null',
        [sessionId, at],
      );
  }

  async setReauth(sessionId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update sessions set reauth_at = $2 where id = $1 and revoked_at is null', [
        sessionId,
        at,
      ]);
  }

  async clearMfa(sessionId: string): Promise<void> {
    await this.transactions
      .current()
      .query(
        'update sessions set mfa_at = null, reauth_at = null where id = $1 and revoked_at is null',
        [sessionId],
      );
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update sessions set last_seen_at = $2 where id = $1 and revoked_at is null', [
        sessionId,
        at,
      ]);
  }

  async revoke(sessionId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [
        sessionId,
        at,
      ]);
  }

  async revokeOthersOfUser(userId: UserId, exceptSessionId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query(
        'update sessions set revoked_at = $3 where user_id = $1 and id <> $2 and revoked_at is null',
        [userId, exceptSessionId, at],
      );
  }

  async listLiveOfUser(
    userId: UserId,
    now: Date,
    idleSince: Date,
  ): Promise<readonly SessionListing[]> {
    const result = await this.transactions.current().query<{
      id: string;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
      user_agent: string | null;
      ip: string | null;
    }>(
      `select id, created_at, last_seen_at, expires_at, user_agent, host(ip) as ip
         from sessions
        where user_id = $1 and revoked_at is null and expires_at > $2 and last_seen_at > $3
        order by last_seen_at desc, id desc`,
      [userId, now, idleSince],
    );
    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
      ip: row.ip,
    }));
  }

  async revokeOfUser(sessionId: string, userId: UserId, at: Date): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query(
        'update sessions set revoked_at = $3 where id = $1 and user_id = $2 and revoked_at is null',
        [sessionId, userId, at],
      );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllOfUser(userId: UserId, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update sessions set revoked_at = $2 where user_id = $1 and revoked_at is null', [
        userId,
        at,
      ]);
  }
}
