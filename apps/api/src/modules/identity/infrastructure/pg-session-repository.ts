/**
 * Invariantes de seguridad
 * - En base de datos solo vive el SHA-256 del token de sesión, nunca el token.
 * - Todo corre en la transacción en curso: RLS limita las sesiones a la organización.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { NewSession, SessionRepository } from '../application/ports/identity-ports.js';

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

  async revokeAllOfUser(userId: UserId, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update sessions set revoked_at = $2 where user_id = $1 and revoked_at is null', [
        userId,
        at,
      ]);
  }
}
