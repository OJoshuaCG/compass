import type { SecretCipher } from '../../crypto/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import { mailSourcePasswordContext } from '../domain/mail-source-password-context.js';
import type { MailConnectionSecretStore } from './ports/mail-connection-secret-store.js';

interface Dependencies {
  readonly store: MailConnectionSecretStore;
  readonly cipher: SecretCipher;
}

/**
 * Recifra la contraseña de los buzones con la DEK activa tras una rotación (ADR 0040). Implementa de
 * forma estructural el puerto `SecretReencryptor` del módulo de mantenimiento. Debe ejecutarse
 * dentro de una transacción de lote con la organización fijada: las filas quedan bloqueadas hasta
 * su cierre. Sin este recorrido, la DEK anterior no se podría retirar.
 */
export class ReencryptMailSourcePasswords {
  readonly name = 'mail_source_connections';

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

    const stale = await store.lockPasswordsBelowVersion(active.value, limit, afterId);
    let resealed = 0;
    let conflicts = 0;
    let failed = 0;
    for (const password of stale) {
      const sealed = await cipher.reseal(
        mailSourcePasswordContext(organizationId, password.sourceId, password.secretVersion),
        {
          ciphertext: password.ciphertext,
          nonce: password.nonce,
          dekVersion: password.dekVersion,
        },
      );
      if (!sealed.ok) {
        failed += 1;
        continue;
      }
      if (sealed.value === null) continue;
      const replaced = await store.replacePassword({
        sourceId: password.sourceId,
        expectedDekVersion: password.dekVersion,
        expectedSecretVersion: password.secretVersion,
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
      lastId: stale.length === 0 ? null : (stale[stale.length - 1]?.sourceId ?? null),
    };
  }

  async countPending(organizationId: OrganizationId): Promise<number> {
    const active = await this.deps.cipher.activeVersion(organizationId);
    if (!active.ok) throw active.error;
    return this.deps.store.countPasswordsBelowVersion(active.value);
  }
}
