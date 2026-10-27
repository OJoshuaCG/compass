/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización.
 * - Baja lógica (`revoked_at`): el rol de la aplicación no tiene DELETE sobre credenciales.
 * - El contador solo avanza: una repetición o un clon de la llave no se acepta.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import { asUserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { PasskeyRecord, PasskeyRepository } from '../application/ports/identity-ports.js';

interface Row {
  id: string;
  user_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  sign_count: string;
  transports: string[];
  name: string;
  created_at: Date;
  last_used_at: Date | null;
}

const UNIQUE_VIOLATION = '23505';

export class PgPasskeyRepository implements PasskeyRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async listLive(userId: UserId): Promise<readonly PasskeyRecord[]> {
    const result = await this.transactions.current().query<Row>(
      `select id, user_id, credential_id, public_key, sign_count, transports, name, created_at, last_used_at
         from webauthn_credentials where user_id = $1 and revoked_at is null
        order by created_at, id`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: asUserId(row.user_id),
      credentialId: row.credential_id.toString('base64url'),
      publicKey: new Uint8Array(row.public_key),
      counter: Number(row.sign_count),
      transports: row.transports,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  async insert(input: {
    userId: UserId;
    credentialId: string;
    publicKey: Uint8Array;
    counter: number;
    transports: readonly string[];
    name: string;
  }): Promise<'inserted' | 'duplicate'> {
    const client = this.transactions.current();
    // Savepoint: una credencial repetida es un resultado esperado y no debe abortar la transacción.
    await client.query('savepoint insert_passkey');
    try {
      await client.query(
        `insert into webauthn_credentials (organization_id, user_id, credential_id, public_key, sign_count, transports, name)
         select organization_id, id, $2, $3, $4, $5::text[], $6 from users where id = $1`,
        [
          input.userId,
          Buffer.from(input.credentialId, 'base64url'),
          Buffer.from(input.publicKey),
          input.counter,
          [...input.transports],
          input.name,
        ],
      );
      await client.query('release savepoint insert_passkey');
      return 'inserted';
    } catch (error) {
      await client.query('rollback to savepoint insert_passkey');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'duplicate';
      throw error;
    }
  }

  async recordUse(id: string, counter: number, at: Date): Promise<boolean> {
    // Con contador 0 (autenticadores que no lo usan) se acepta; si no, debe ser estrictamente mayor.
    const result = await this.transactions.current().query(
      `update webauthn_credentials set sign_count = $2, last_used_at = $3
        where id = $1 and revoked_at is null and ($2 = 0 and sign_count = 0 or $2 > sign_count)`,
      [id, counter, at],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revoke(id: string, userId: UserId, at: Date): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query(
        'update webauthn_credentials set revoked_at = $3 where id = $1 and user_id = $2 and revoked_at is null',
        [id, userId, at],
      );
    return (result.rowCount ?? 0) > 0;
  }
}
