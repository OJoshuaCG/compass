/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita el borrado a la organización fijada.
 * - Solo borra versiones NO vigentes (`is_current = false`) del campo pedido; la política
 *   `credential_secrets_purge_old` (migración 0005) lo impone además en la base, aunque este SQL fallara.
 * - Solo borra una versión si existe una posterior (la que la reemplazó) creada antes del corte.
 * - No lee ni descifra el contenido: no toca `ciphertext`, `nonce` ni `dek_version`.
 */
import type { TransactionProvider } from '../../organization/index.js';

/**
 * Campos cuya retención de versiones viejas está decidida. Los demás (`username`, `recovery_codes`,
 * `secret_notes`) no se purgan hasta que el dueño decida su plazo.
 */
export type PurgeableSecretField = 'totp_uri' | 'password';

/**
 * `credential_secrets` no guarda cuándo se reemplazó una versión, solo cuándo se creó. El momento del
 * reemplazo es el de creación de la versión que la sustituyó (quien guarda la nueva retira la anterior en la
 * misma transacción), así que una versión vieja se borra si existe alguna posterior creada en
 * `replacedBefore` o antes. La versión posterior más antigua marca el reemplazo, y cualquier otra es igual de
 * vieja o más, por lo que basta con que exista una.
 */
export async function purgeReplacedSecretVersions(
  transactions: TransactionProvider,
  field: PurgeableSecretField,
  replacedBefore: Date,
  limit: number,
): Promise<number> {
  const result = await transactions.current().query(
    `delete from credential_secrets
      where ctid in (
        select replaced.ctid
          from credential_secrets as replaced
         where replaced.field = $1
           and not replaced.is_current
           and exists (
             select 1
               from credential_secrets as successor
              where successor.organization_id = replaced.organization_id
                and successor.credential_id = replaced.credential_id
                and successor.field = replaced.field
                and successor.version > replaced.version
                and successor.created_at <= $2
           )
         limit $3
      )`,
    [field, replacedBefore, limit],
  );
  return result.rowCount ?? 0;
}
