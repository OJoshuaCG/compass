/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: el aislamiento por filas limita las consultas a la organización fijada.
 * - Solo toca el texto cifrado de la contraseña; nunca la descifra ni la registra.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  MailConnectionSecretStore,
  StaleMailPassword,
} from '../application/ports/mail-connection-secret-store.js';

interface PasswordRow {
  source_id: string;
  secret_version: number;
  password_ciphertext: Buffer;
  password_nonce: Buffer;
  dek_version: number;
}

export class PgMailConnectionSecretStore implements MailConnectionSecretStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async lockPasswordsBelowVersion(
    activeVersion: number,
    limit: number,
    afterSourceId: string | null,
  ): Promise<readonly StaleMailPassword[]> {
    // El cursor evita volver a elegir la misma ventana si hay filas ilegibles o bloqueadas al frente.
    const result = await this.transactions.current().query<PasswordRow>(
      `select source_id, secret_version, password_ciphertext, password_nonce, dek_version
         from mail_source_connections
        where dek_version < $1
          and ($3::uuid is null or source_id > $3::uuid)
        order by source_id
        limit $2
          for update skip locked`,
      [activeVersion, limit, afterSourceId],
    );
    return result.rows.map((row) => ({
      sourceId: row.source_id,
      secretVersion: row.secret_version,
      ciphertext: new Uint8Array(row.password_ciphertext),
      nonce: new Uint8Array(row.password_nonce),
      dekVersion: row.dek_version,
    }));
  }

  async replacePassword(input: {
    readonly sourceId: string;
    readonly expectedDekVersion: number;
    readonly expectedSecretVersion: number;
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly dekVersion: number;
  }): Promise<boolean> {
    const result = await this.transactions.current().query(
      `update mail_source_connections
          set password_ciphertext = $4, password_nonce = $5, dek_version = $6
        where source_id = $1 and dek_version = $2 and secret_version = $3`,
      [
        input.sourceId,
        input.expectedDekVersion,
        input.expectedSecretVersion,
        Buffer.from(input.ciphertext),
        Buffer.from(input.nonce),
        input.dekVersion,
      ],
    );
    return result.rowCount === 1;
  }

  async countPasswordsBelowVersion(activeVersion: number): Promise<number> {
    const result = await this.transactions
      .current()
      .query<{ pending: string }>(
        'select count(*) as pending from mail_source_connections where dek_version < $1',
        [activeVersion],
      );
    return Number(result.rows[0]?.pending ?? '0');
  }
}
