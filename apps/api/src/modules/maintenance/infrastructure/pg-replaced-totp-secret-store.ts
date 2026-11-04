/**
 * Purga las versiones reemplazadas del secreto del segundo factor (`totp_uri`). Las invariantes de
 * seguridad están en `purge-replaced-secret-versions.ts`.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { ReplacedTotpSecretStore } from '../application/ports/purge-ports.js';
import { purgeReplacedSecretVersions } from './purge-replaced-secret-versions.js';

export class PgReplacedTotpSecretStore implements ReplacedTotpSecretStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async purgeReplacedTotpSecrets(replacedBefore: Date, limit: number): Promise<number> {
    return purgeReplacedSecretVersions(this.transactions, 'totp_uri', replacedBefore, limit);
  }
}
