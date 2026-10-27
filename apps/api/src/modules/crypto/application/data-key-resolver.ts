import { DomainError } from '../../../shared/kernel/index.js';
import type { Clock, OrganizationId } from '../../../shared/kernel/index.js';
import { kmsUnavailable, unknownDekVersion } from '../domain/crypto-errors.js';
import type { DekCache } from './dek-cache.js';
import type { DataKeyRepository } from './ports/data-key-repository.js';
import type { KeyManagementPort } from './ports/key-management-port.js';

export interface DataKeyResolverDeps {
  readonly repository: DataKeyRepository;
  readonly kms: KeyManagementPort;
  readonly cache: DekCache;
  readonly clock: Clock;
  /**
   * Ejecuta `fn` en una transacción propia que se confirma de inmediato. Crear o rotar una DEK no
   * puede quedar atado a la transacción del llamador: si esta se revierte, las cachés (versión
   * activa y DEK en claro) apuntarían a una versión que ya no existe. En pruebas unitarias basta
   * `(fn) => fn()`.
   */
  readonly independently: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Cuánto se recuerda cuál es la versión activa antes de volver a consultarla. */
  readonly activeVersionTtlMs?: number;
}

export const DEFAULT_ACTIVE_VERSION_TTL_MS = 60_000;

const cacheKey = (organizationId: OrganizationId, version: number): string =>
  `${organizationId}:${String(version)}`;

/**
 * Entrega la DEK correcta de una organización sin exponerla fuera de un callback síncrono.
 * Los errores de infraestructura del KMS se traducen a `CRYPTO.KMS_UNAVAILABLE` (falla cerrada).
 */
export class DataKeyResolver {
  private readonly activeVersions = new Map<string, { version: number; expiresAt: number }>();
  private readonly activeTtlMs: number;

  constructor(private readonly deps: DataKeyResolverDeps) {
    this.activeTtlMs = deps.activeVersionTtlMs ?? DEFAULT_ACTIVE_VERSION_TTL_MS;
  }

  async withActiveKey<T>(
    organizationId: OrganizationId,
    use: (key: Uint8Array, version: number) => T,
  ): Promise<T> {
    const version = await this.activeVersion(organizationId);
    return this.withKey(organizationId, version, (key) => use(key, version));
  }

  withKey<T>(
    organizationId: OrganizationId,
    version: number,
    use: (key: Uint8Array) => T,
  ): Promise<T> {
    return this.deps.cache.withKey(
      cacheKey(organizationId, version),
      () => this.loadKey(organizationId, version),
      use,
    );
  }

  /** Sobrescribe con ceros todas las DEK en memoria (apagado ordenado del proceso). */
  clearCache(): void {
    this.deps.cache.clear();
    this.activeVersions.clear();
  }

  /**
   * Crea una versión nueva de la DEK y retira la anterior. El recifrado de los secretos
   * existentes lo hace un job aparte; mientras tanto conviven ambas versiones.
   */
  async rotate(organizationId: OrganizationId): Promise<number> {
    const current = await this.deps.repository.findActive(organizationId);
    const version = (current?.version ?? 0) + 1;
    const outcome = await this.deps.independently(() =>
      this.createVersion(organizationId, version),
    );
    if (outcome === 'conflict') {
      throw new DomainError('CRYPTO.KMS_UNAVAILABLE', 'Concurrent data key rotation detected', {
        version,
      });
    }
    this.activeVersions.delete(organizationId);
    return version;
  }

  private async activeVersion(organizationId: OrganizationId): Promise<number> {
    const cached = this.activeVersions.get(organizationId);
    if (cached !== undefined && this.deps.clock.now().getTime() < cached.expiresAt) {
      return cached.version;
    }
    let record = await this.deps.repository.findActive(organizationId);
    if (record === null) {
      // Primera vez de la organización: se crea la versión 1. Si otra instancia gana la
      // carrera, la restricción única devuelve `conflict` y se relee la que quedó activa.
      await this.deps.independently(() => this.createVersion(organizationId, 1));
      record = await this.deps.repository.findActive(organizationId);
      if (record === null) throw kmsUnavailable();
    }
    this.activeVersions.set(organizationId, {
      version: record.version,
      expiresAt: this.deps.clock.now().getTime() + this.activeTtlMs,
    });
    return record.version;
  }

  private async createVersion(
    organizationId: OrganizationId,
    version: number,
  ): Promise<'inserted' | 'conflict'> {
    let generated;
    try {
      generated = await this.deps.kms.generateDataKey({ organizationId });
    } catch (cause) {
      throw new DomainError(
        'CRYPTO.KMS_UNAVAILABLE',
        'Key management service is unavailable',
        {},
        { cause },
      );
    }
    // Solo se persiste la DEK envuelta; el texto en claro se descarta de inmediato.
    generated.plaintext.fill(0);
    return this.deps.repository.insertAsActive({
      organizationId,
      version,
      wrapped: generated.wrapped,
      kmsKeyRef: generated.keyRef,
    });
  }

  private async loadKey(organizationId: OrganizationId, version: number): Promise<Uint8Array> {
    const record = await this.deps.repository.findByVersion(organizationId, version);
    if (record === null) throw unknownDekVersion(version);
    try {
      return await this.deps.kms.decryptDataKey({
        organizationId,
        wrapped: record.wrapped,
        keyRef: record.kmsKeyRef,
      });
    } catch (cause) {
      throw new DomainError(
        'CRYPTO.KMS_UNAVAILABLE',
        'Key management service is unavailable',
        {},
        { cause },
      );
    }
  }
}
