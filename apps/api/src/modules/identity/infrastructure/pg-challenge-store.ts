/**
 * Invariantes de seguridad
 * - Un desafío es de un solo uso: se marca usado al tomarlo, en la misma sentencia que lo lee.
 * - Va ligado a la persona y a la finalidad: no sirve para otra ceremonia ni para otra persona.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { ChallengePurpose, ChallengeStore } from '../application/ports/identity-ports.js';

export class PgChallengeStore implements ChallengeStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async issue(input: {
    userId: UserId;
    purpose: ChallengePurpose;
    challenge: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.transactions.current().query(
      `insert into webauthn_challenges (organization_id, user_id, purpose, challenge, expires_at)
       select organization_id, id, $2, $3, $4 from users where id = $1`,
      [input.userId, input.purpose, input.challenge, input.expiresAt],
    );
  }

  async consume(userId: UserId, purpose: ChallengePurpose, now: Date): Promise<string | null> {
    const result = await this.transactions.current().query<{ challenge: string }>(
      `update webauthn_challenges set used_at = $3
        where id = (
          select id from webauthn_challenges
           where user_id = $1 and purpose = $2 and used_at is null and expires_at > $3
           order by created_at desc, id desc limit 1 for update skip locked)
        returning challenge`,
      [userId, purpose, now],
    );
    return result.rows[0]?.challenge ?? null;
  }
}
