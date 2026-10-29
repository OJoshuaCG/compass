/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita el borrado a la organización fijada.
 * - Solo borra versiones NO vigentes (`is_current = false`) del campo `totp_uri`; la política
 *   `credential_secrets_purge_old` (migración 0005) lo impone además en la base, aunque este SQL fallara.
 * - Solo borra una versión si existe una posterior (el re-registro que la reemplazó) creada antes del corte.
 * - No lee ni descifra el contenido: no toca `ciphertext`, `nonce` ni `dek_version`.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { ReplacedTotpSecretStore } from '../application/ports/purge-ports.js';

export class PgReplacedTotpSecretStore implements ReplacedTotpSecretStore {
  constructor(private readonly transactions: TransactionProvider) {}

  /**
   * `credential_secrets` no guarda cuándo se reemplazó una versión, solo cuándo se creó. El momento del
   * reemplazo es el de creación de la versión que la sustituyó (el re-registro inserta la nueva en la misma
   * transacción que retira la anterior), así que una versión vieja se borra si existe alguna posterior
   * creada en `replacedBefore` o antes. La versión posterior más antigua marca el reemplazo, y cualquier
   * otra es igual de vieja o más, por lo que basta con que exista una.
   */
  async purgeReplacedTotpSecrets(replacedBefore: Date, limit: number): Promise<number> {
    const result = await this.transactions.current().query(
      `delete from credential_secrets
        where ctid in (
          select replaced.ctid
            from credential_secrets as replaced
           where replaced.field = 'totp_uri'
             and not replaced.is_current
             and exists (
               select 1
                 from credential_secrets as successor
                where successor.organization_id = replaced.organization_id
                  and successor.credential_id = replaced.credential_id
                  and successor.field = replaced.field
                  and successor.version > replaced.version
                  and successor.created_at <= $1
             )
           limit $2
        )`,
      [replacedBefore, limit],
    );
    return result.rowCount ?? 0;
  }
}
