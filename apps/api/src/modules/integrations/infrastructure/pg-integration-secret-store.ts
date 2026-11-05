/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: el aislamiento por filas limita las consultas a la organización fijada.
 * - Solo toca el texto cifrado de los secretos; nunca los descifra ni los registra.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  IntegrationSecretStore,
  StaleIntegrationSecret,
} from '../application/ports/integration-secret-store.js';
import {
  parseIntegrationSecretCursor,
  type IntegrationSecretField,
} from '../domain/integration-secret-context.js';

interface SecretRow {
  integration_id: string;
  field: IntegrationSecretField;
  secret_version: number;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
}

export class PgIntegrationSecretStore implements IntegrationSecretStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async lockSecretsBelowVersion(
    activeVersion: number,
    limit: number,
    afterCursor: string | null,
  ): Promise<readonly StaleIntegrationSecret[]> {
    let afterIntegrationId: string | null = null;
    let afterField: string | null = null;
    if (afterCursor !== null) {
      const parsed = parseIntegrationSecretCursor(afterCursor);
      // Un cursor ilegible reiniciaría el recorrido y podría ciclar sin avance: mejor fallar.
      if (parsed === null) throw new Error('INTEGRATION_SECRET_CURSOR_INVALID');
      afterIntegrationId = parsed.integrationId;
      afterField = parsed.field;
    }
    // El cursor evita volver a elegir la misma ventana si hay filas ilegibles o bloqueadas al frente.
    const result = await this.transactions.current().query<SecretRow>(
      `select integration_id, field, secret_version, ciphertext, nonce, dek_version
         from integration_secrets
        where dek_version < $1
          and ($3::uuid is null or (integration_id, field) > ($3::uuid, $4::text))
        order by integration_id, field
        limit $2
          for update skip locked`,
      [activeVersion, limit, afterIntegrationId, afterField],
    );
    return result.rows.map((row) => ({
      integrationId: row.integration_id,
      field: row.field,
      secretVersion: row.secret_version,
      ciphertext: new Uint8Array(row.ciphertext),
      nonce: new Uint8Array(row.nonce),
      dekVersion: row.dek_version,
    }));
  }

  async replaceSecret(input: {
    readonly integrationId: string;
    readonly field: IntegrationSecretField;
    readonly expectedDekVersion: number;
    readonly expectedSecretVersion: number;
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly dekVersion: number;
  }): Promise<boolean> {
    const result = await this.transactions.current().query(
      `update integration_secrets
          set ciphertext = $5, nonce = $6, dek_version = $7
        where integration_id = $1 and field = $2 and dek_version = $3 and secret_version = $4`,
      [
        input.integrationId,
        input.field,
        input.expectedDekVersion,
        input.expectedSecretVersion,
        Buffer.from(input.ciphertext),
        Buffer.from(input.nonce),
        input.dekVersion,
      ],
    );
    return result.rowCount === 1;
  }

  async countSecretsBelowVersion(activeVersion: number): Promise<number> {
    const result = await this.transactions
      .current()
      .query<{ pending: string }>(
        'select count(*) as pending from integration_secrets where dek_version < $1',
        [activeVersion],
      );
    return Number(result.rows[0]?.pending ?? '0');
  }
}
