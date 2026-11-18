/**
 * Invariantes de seguridad
 * - `oidc_signing_keys` no se toca directamente (`iam_app` no tiene `GRANT`): solo por las funciones
 *   `auth.*` de la migración 0045, que fijan el esquema y limitan lo que se puede hacer.
 * - Solo se maneja el sobre cifrado; la clave privada en claro nunca llega a este archivo.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  Jwk,
  SigningAlgorithm,
  SigningKeyStore,
  StoredSigningKey,
} from '../application/ports/signing-keys.js';

interface SigningKeyRow {
  readonly kid: string;
  readonly alg: SigningAlgorithm;
  readonly public_jwk: Jwk;
  readonly private_jwk_ciphertext: Buffer;
}

export class PgSigningKeyStore implements SigningKeyStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async listActive(): Promise<readonly StoredSigningKey[]> {
    const { rows } = await this.transactions
      .current()
      .query<SigningKeyRow>(
        'select kid, alg, public_jwk, private_jwk_ciphertext from auth.list_oidc_signing_keys()',
      );
    return rows.map((row) => ({
      kid: row.kid,
      algorithm: row.alg,
      publicJwk: row.public_jwk,
      privateJwkCiphertext: new Uint8Array(row.private_jwk_ciphertext),
    }));
  }

  async add(key: StoredSigningKey): Promise<void> {
    await this.transactions
      .current()
      .query('select auth.add_oidc_signing_key($1, $2, $3::jsonb, $4)', [
        key.kid,
        key.algorithm,
        JSON.stringify(key.publicJwk),
        Buffer.from(key.privateJwkCiphertext),
      ]);
  }

  async retire(kid: string): Promise<boolean> {
    const { rows } = await this.transactions
      .current()
      .query<{ retired: boolean }>('select auth.retire_oidc_signing_key($1) as retired', [kid]);
    return rows[0]?.retired === true;
  }
}
