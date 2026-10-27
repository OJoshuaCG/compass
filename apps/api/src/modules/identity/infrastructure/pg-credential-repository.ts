/**
 * Invariantes de seguridad
 * - Contraseñas: solo el hash Argon2id. Secretos TOTP: solo su texto cifrado (SecretCipher).
 * - Códigos de recuperación: solo su SHA-256; un código se consume de forma atómica (una sola vez).
 * - Un paso TOTP se acepta solo si es mayor al último usado: un código no se puede reutilizar.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  CredentialRepository,
  TotpFactorRecord,
} from '../application/ports/identity-ports.js';

interface FactorRow {
  id: string;
  user_id: string;
  secret_ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
  verified_at: Date | null;
  last_used_step: string | null;
}

export class PgCredentialRepository implements CredentialRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async savePassword(userId: UserId, argon2Hash: string, mustChange: boolean): Promise<void> {
    await this.transactions.current().query(
      `insert into user_passwords (organization_id, user_id, argon2_hash, must_change)
       select organization_id, id, $2, $3 from users where id = $1
       on conflict (organization_id, user_id)
       do update set argon2_hash = excluded.argon2_hash, must_change = excluded.must_change, changed_at = now()`,
      [userId, argon2Hash, mustChange],
    );
  }

  async findPassword(
    userId: UserId,
  ): Promise<{ readonly hash: string; readonly mustChange: boolean } | null> {
    const result = await this.transactions
      .current()
      .query<{ argon2_hash: string; must_change: boolean }>(
        'select argon2_hash, must_change from user_passwords where user_id = $1',
        [userId],
      );
    const row = result.rows[0];
    return row === undefined ? null : { hash: row.argon2_hash, mustChange: row.must_change };
  }

  async findTotpFactor(userId: UserId): Promise<TotpFactorRecord | null> {
    const result = await this.transactions.current().query<FactorRow>(
      `select id, user_id, secret_ciphertext, nonce, dek_version, verified_at, last_used_step
         from user_totp_factors where user_id = $1 and revoked_at is null`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.user_id as UserId,
      ciphertext: new Uint8Array(row.secret_ciphertext),
      nonce: new Uint8Array(row.nonce),
      dekVersion: row.dek_version,
      verifiedAt: row.verified_at,
      lastUsedStep: row.last_used_step === null ? null : Number(row.last_used_step),
    };
  }

  async saveUnverifiedTotpFactor(input: {
    readonly userId: UserId;
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly dekVersion: number;
  }): Promise<void> {
    const client = this.transactions.current();
    // Solo se reemplaza un factor aún no verificado: uno verificado nunca se pisa en silencio.
    // Baja lógica (`revoked_at`): el rol de la aplicación no tiene DELETE sobre credenciales.
    await client.query(
      'update user_totp_factors set revoked_at = now() where user_id = $1 and verified_at is null and revoked_at is null',
      [input.userId],
    );
    await client.query(
      `insert into user_totp_factors (organization_id, user_id, secret_ciphertext, nonce, dek_version)
       select organization_id, id, $2, $3, $4 from users where id = $1`,
      [input.userId, Buffer.from(input.ciphertext), Buffer.from(input.nonce), input.dekVersion],
    );
  }

  async markTotpVerified(factorId: string, at: Date, step: number): Promise<void> {
    await this.transactions
      .current()
      .query('update user_totp_factors set verified_at = $2, last_used_step = $3 where id = $1', [
        factorId,
        at,
        step,
      ]);
  }

  async advanceTotpStep(factorId: string, step: number): Promise<boolean> {
    const result = await this.transactions.current().query(
      `update user_totp_factors set last_used_step = $2
        where id = $1 and (last_used_step is null or last_used_step < $2)`,
      [factorId, step],
    );
    return result.rowCount === 1;
  }

  async replaceRecoveryCodes(userId: UserId, hashes: readonly Uint8Array[]): Promise<void> {
    const client = this.transactions.current();
    // Los códigos anteriores se invalidan marcándolos como usados (sin DELETE para el rol de la aplicación).
    await client.query(
      "update user_recovery_codes set used_at = now() where user_id = $1 and used_at is null and kind = 'recovery'",
      [userId],
    );
    for (const hash of hashes) {
      await client.query(
        `insert into user_recovery_codes (organization_id, user_id, code_hash)
         select organization_id, id, $2 from users where id = $1`,
        [userId, Buffer.from(hash)],
      );
    }
  }

  async consumeRecoveryCode(
    userId: UserId,
    hash: Uint8Array,
    at: Date,
  ): Promise<'recovery' | 'emergency' | null> {
    const result = await this.transactions.current().query<{ kind: 'recovery' | 'emergency' }>(
      `update user_recovery_codes set used_at = $3
        where user_id = $1 and code_hash = $2 and used_at is null returning kind`,
      [userId, Buffer.from(hash), at],
    );
    return result.rows[0]?.kind ?? null;
  }

  async revokeSecondFactor(userId: UserId, at: Date): Promise<void> {
    const client = this.transactions.current();
    await client.query(
      'update user_totp_factors set revoked_at = $2 where user_id = $1 and revoked_at is null',
      [userId, at],
    );
    // Las llaves de acceso también son segundo factor: un restablecimiento no puede dejarlas vivas.
    await client.query(
      'update webauthn_credentials set revoked_at = $2 where user_id = $1 and revoked_at is null',
      [userId, at],
    );
    await client.query(
      "update user_recovery_codes set used_at = $2 where user_id = $1 and used_at is null and kind = 'recovery'",
      [userId, at],
    );
  }
}
