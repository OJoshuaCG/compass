import type { SecretCipher } from '../../crypto/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import {
  clientSecretContext,
  packClientSecret,
  unpackClientSecret,
} from '../domain/client-secret.js';
import type { OidcClientSecretStore } from './ports/oidc-client-secret-store.js';

interface Dependencies {
  readonly store: OidcClientSecretStore;
  readonly cipher: Pick<SecretCipher, 'activeVersion' | 'reseal'>;
}

/**
 * Recifra los secretos de los clientes OIDC con la DEK activa tras una rotación (ADR 0040). Implementa de
 * forma estructural el puerto `SecretReencryptor` del módulo de mantenimiento. Debe ejecutarse dentro de
 * una transacción de lote con la organización fijada: las filas quedan bloqueadas hasta su cierre. Sin este
 * recorrido, la DEK anterior no se podría retirar sin dejar a los clientes sin poder autenticarse.
 */
export class ReencryptOidcClientSecrets {
  readonly name = 'oidc_client_secrets';

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
    for (const entry of stale) {
      const secret = unpackClientSecret(entry.packedSecret);
      // Un valor con formato inesperado no se puede abrir: se cuenta como fallo, sin registrar su contenido.
      if (secret === null) {
        failed += 1;
        continue;
      }
      const sealed = await cipher.reseal(
        clientSecretContext(organizationId, entry.clientRowId),
        secret,
      );
      if (!sealed.ok) {
        failed += 1;
        continue;
      }
      if (sealed.value === null) continue;
      const replaced = await store.replaceSecretIfUnchanged(
        entry.clientRowId,
        entry.packedSecret,
        packClientSecret(sealed.value),
      );
      if (replaced) resealed += 1;
      else conflicts += 1;
    }
    const last = stale[stale.length - 1];
    return {
      resealed,
      conflicts,
      failed,
      examined: stale.length,
      lastId: last === undefined ? null : last.clientRowId,
    };
  }

  async countPending(organizationId: OrganizationId): Promise<number> {
    const active = await this.deps.cipher.activeVersion(organizationId);
    if (!active.ok) throw active.error;
    return this.deps.store.countSecretsBelowVersion(active.value);
  }
}
