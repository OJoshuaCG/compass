/**
 * Invariantes de seguridad
 * - Un desafío es de un solo uso: se marca usado al tomarlo, en la misma sentencia que lo lee.
 * - Va ligado a la persona, a la sesión y a la finalidad: no sirve para otra ceremonia, otra persona
 *   ni otra sesión, y solo hay uno vigente por sesión y finalidad.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { ChallengePurpose, ChallengeStore } from '../application/ports/identity-ports.js';

export class PgChallengeStore implements ChallengeStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async issue(input: {
    userId: UserId;
    sessionId: string;
    purpose: ChallengePurpose;
    challenge: string;
    expiresAt: Date;
  }): Promise<void> {
    const client = this.transactions.current();
    // Un solo desafío vivo por sesión y finalidad: el nuevo reemplaza al pendiente.
    await client.query(
      `update webauthn_challenges set used_at = now()
        where user_id = $1 and session_id = $2 and purpose = $3 and used_at is null`,
      [input.userId, input.sessionId, input.purpose],
    );
    await client.query(
      `insert into webauthn_challenges (organization_id, user_id, session_id, purpose, challenge, expires_at)
       select organization_id, id, $2, $3, $4, $5 from users where id = $1`,
      [input.userId, input.sessionId, input.purpose, input.challenge, input.expiresAt],
    );
  }

  async consume(
    userId: UserId,
    sessionId: string,
    purpose: ChallengePurpose,
    now: Date,
  ): Promise<string | null> {
    const result = await this.transactions.current().query<{ challenge: string }>(
      `update webauthn_challenges set used_at = $4
        where id = (
          select id from webauthn_challenges
           where user_id = $1 and session_id = $2 and purpose = $3 and used_at is null and expires_at > $4
           order by created_at desc, id desc limit 1 for update skip locked)
        returning challenge`,
      [userId, sessionId, purpose, now],
    );
    return result.rows[0]?.challenge ?? null;
  }
}
