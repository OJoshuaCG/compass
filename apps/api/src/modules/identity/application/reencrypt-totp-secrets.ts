import { totpSecretContext } from '../domain/totp-secret-context.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { CredentialRepository } from './ports/identity-ports.js';

export interface TotpReencryptionBatch {
  readonly resealed: number;
  readonly conflicts: number;
  readonly failed: number;
  /** Filas que el lote tomó, hayan o no cambiado; 0 significa que no queda nada más por recorrer. */
  readonly examined: number;
  /** Cursor para el siguiente lote; `null` si este no tomó ninguna fila. */
  readonly lastId: string | null;
}

interface Dependencies {
  readonly credentials: CredentialRepository;
  readonly cipher: SecretCipher;
}

/**
 * Recifra los secretos TOTP con la DEK activa tras una rotación (ADR 0040). Implementa de forma
 * estructural el puerto `SecretReencryptor` del módulo de mantenimiento. Debe ejecutarse dentro de
 * una transacción de lote con la organización fijada: las filas quedan bloqueadas hasta su cierre.
 */
export class ReencryptTotpSecrets {
  readonly name = 'user_totp_factors';

  constructor(private readonly deps: Dependencies) {}

  async reencryptBatch(
    organizationId: OrganizationId,
    limit: number,
    afterId: string | null,
  ): Promise<TotpReencryptionBatch> {
    const { credentials, cipher } = this.deps;
    const active = await cipher.activeVersion(organizationId);
    if (!active.ok) throw active.error;

    const stale = await credentials.lockTotpFactorsBelowVersion(active.value, limit, afterId);
    let resealed = 0;
    let conflicts = 0;
    let failed = 0;
    for (const factor of stale) {
      const sealed = await cipher.reseal(totpSecretContext(organizationId, factor.userId), {
        ciphertext: factor.ciphertext,
        nonce: factor.nonce,
        dekVersion: factor.dekVersion,
      });
      if (!sealed.ok) {
        failed += 1;
        continue;
      }
      if (sealed.value === null) continue;
      const replaced = await credentials.replaceTotpSecret({
        factorId: factor.id,
        expectedDekVersion: factor.dekVersion,
        ciphertext: sealed.value.ciphertext,
        nonce: sealed.value.nonce,
        dekVersion: sealed.value.dekVersion,
      });
      if (replaced) resealed += 1;
      else conflicts += 1;
    }
    return {
      resealed,
      conflicts,
      failed,
      examined: stale.length,
      lastId: stale.length === 0 ? null : (stale[stale.length - 1]?.id ?? null),
    };
  }

  async countPending(organizationId: OrganizationId): Promise<number> {
    const active = await this.deps.cipher.activeVersion(organizationId);
    if (!active.ok) throw active.error;
    return this.deps.credentials.countTotpFactorsBelowVersion(active.value);
  }
}
