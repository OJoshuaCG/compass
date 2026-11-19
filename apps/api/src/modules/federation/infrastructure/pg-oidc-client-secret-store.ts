/**
 * Acceso al secreto cifrado de `oidc_clients` para la migración a la DEK activa (ADR 0040).
 *
 * Invariantes de seguridad
 * - Todo corre en la transacción de lote en curso: RLS limita las filas a la organización fijada.
 * - Nunca se registra ni se devuelve en claro: el valor viaja cifrado y empaquetado.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  OidcClientSecretStore,
  StaleOidcClientSecret,
} from '../application/ports/oidc-client-secret-store.js';

interface SecretRow {
  readonly id: string;
  readonly secret_ciphertext: Buffer;
}

/**
 * La versión de la DEK son los 4 primeros bytes del valor empaquetado, en big endian (ver `client-secret.ts`).
 * Se calcula en bigint para que un primer byte alto no produzca un número negativo. Un valor de menos de 4
 * bytes da `null`, que la comparación `< $1` descarta: ese caso no es migrable y no debe contarse como pendiente.
 */
const PACKED_DEK_VERSION_SQL = `(case when length(secret_ciphertext) >= 4 then
         get_byte(secret_ciphertext, 0)::bigint * 16777216
       + get_byte(secret_ciphertext, 1)::bigint * 65536
       + get_byte(secret_ciphertext, 2)::bigint * 256
       + get_byte(secret_ciphertext, 3)::bigint
     end)`;

export class PgOidcClientSecretStore implements OidcClientSecretStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async lockSecretsBelowVersion(
    activeVersion: number,
    limit: number,
    afterId: string | null,
  ): Promise<readonly StaleOidcClientSecret[]> {
    // El cursor `id > afterId` hace que el pase avance aunque haya filas ilegibles o bloqueadas al frente.
    const result = await this.transactions.current().query<SecretRow>(
      `select id, secret_ciphertext
         from oidc_clients
        where ${PACKED_DEK_VERSION_SQL} < $1
          and ($3::uuid is null or id > $3::uuid)
        order by id
        limit $2
          for update skip locked`,
      [activeVersion, limit, afterId],
    );
    return result.rows.map((row) => ({
      clientRowId: row.id,
      packedSecret: new Uint8Array(row.secret_ciphertext),
    }));
  }

  async replaceSecretIfUnchanged(
    clientRowId: string,
    expectedPackedSecret: Uint8Array,
    newPackedSecret: Uint8Array,
  ): Promise<boolean> {
    const result = await this.transactions.current().query(
      `update oidc_clients set secret_ciphertext = $3
        where id = $1 and secret_ciphertext = $2`,
      [clientRowId, Buffer.from(expectedPackedSecret), Buffer.from(newPackedSecret)],
    );
    return result.rowCount === 1;
  }

  async countSecretsBelowVersion(activeVersion: number): Promise<number> {
    const result = await this.transactions
      .current()
      .query<{ pending: string }>(
        `select count(*) as pending from oidc_clients where ${PACKED_DEK_VERSION_SQL} < $1`,
        [activeVersion],
      );
    return Number(result.rows[0]?.pending ?? '0');
  }
}
