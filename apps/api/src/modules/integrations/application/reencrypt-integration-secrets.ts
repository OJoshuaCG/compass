import type { SecretCipher } from '../../crypto/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import {
  formatIntegrationSecretCursor,
  integrationSecretContext,
} from '../domain/integration-secret-context.js';
import type { IntegrationSecretStore } from './ports/integration-secret-store.js';

interface Dependencies {
  readonly store: IntegrationSecretStore;
  readonly cipher: Pick<SecretCipher, 'activeVersion' | 'reseal'>;
}

/**
 * Recifra los secretos de las integraciones (token de bot, llave de API) con la DEK activa tras una
 * rotación (ADR 0040). Implementa de forma estructural el puerto `SecretReencryptor` del módulo de
 * mantenimiento. Debe ejecutarse dentro de una transacción de lote con la organización fijada: las
 * filas quedan bloqueadas hasta su cierre. Sin este recorrido, la DEK anterior no se podría retirar.
 */
export class ReencryptIntegrationSecrets {
  readonly name = 'integration_secrets';

  constructor(private readonly deps: Dependencies) {}

  async reencryptBatch(
    organizationId: OrganizationId,
    limit: number,
    afterId: string | null,
  ): Promise<{
    resealed: number;
    conflicts: number;
    failed: number;
    examined: number;
    lastId: string | null;
  }> {
    const { store, cipher } = this.deps;
    const active = await cipher.activeVersion(organizationId);
    if (!active.ok) throw active.error;

    const stale = await store.lockSecretsBelowVersion(active.value, limit, afterId);
    let resealed = 0;
    let conflicts = 0;
    let failed = 0;
    for (const secret of stale) {
      const sealed = await cipher.reseal(
        integrationSecretContext(
          organizationId,
          secret.integrationId,
          secret.field,
          secret.secretVersion,
        ),
        {
          ciphertext: secret.ciphertext,
          nonce: secret.nonce,
          dekVersion: secret.dekVersion,
        },
      );
      if (!sealed.ok) {
        failed += 1;
        continue;
      }
      if (sealed.value === null) continue;
      const replaced = await store.replaceSecret({
        integrationId: secret.integrationId,
        field: secret.field,
        expectedDekVersion: secret.dekVersion,
        expectedSecretVersion: secret.secretVersion,
        ciphertext: sealed.value.ciphertext,
        nonce: sealed.value.nonce,
        dekVersion: sealed.value.dekVersion,
      });
      if (replaced) resealed += 1;
      else conflicts += 1;
    }
    const lastSecret = stale[stale.length - 1];
    return {
      resealed,
      conflicts,
      failed,
      examined: stale.length,
      lastId:
        lastSecret === undefined
          ? null
          : formatIntegrationSecretCursor(lastSecret.integrationId, lastSecret.field),
    };
  }

  async countPending(organizationId: OrganizationId): Promise<number> {
    const active = await this.deps.cipher.activeVersion(organizationId);
    if (!active.ok) throw active.error;
    return this.deps.store.countSecretsBelowVersion(active.value);
  }
}
