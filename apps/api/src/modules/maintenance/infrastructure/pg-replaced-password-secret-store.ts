/**
 * Purga las versiones reemplazadas de la contraseña de una credencial (`password`, TODO C9). Las
 * invariantes de seguridad están en `purge-replaced-secret-versions.ts`.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { ReplacedPasswordSecretStore } from '../application/ports/purge-ports.js';
import { purgeReplacedSecretVersions } from './purge-replaced-secret-versions.js';

export class PgReplacedPasswordSecretStore implements ReplacedPasswordSecretStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async purgeReplacedPasswordSecrets(replacedBefore: Date, limit: number): Promise<number> {
    return purgeReplacedSecretVersions(this.transactions, 'password', replacedBefore, limit);
  }
}
