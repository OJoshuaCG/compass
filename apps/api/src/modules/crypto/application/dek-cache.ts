import type { Clock } from '../../../shared/kernel/index.js';

export interface DekCacheOptions {
  readonly clock: Clock;
  readonly ttlMs?: number;
  readonly maxUses?: number;
  readonly maxEntries?: number;
}

interface Entry {
  readonly key: Uint8Array;
  readonly expiresAt: number;
  uses: number;
}

export const DEFAULT_DEK_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_DEK_MAX_USES = 10_000;
export const DEFAULT_DEK_MAX_ENTRIES = 1_000;

/**
 * Caché LRU de DEK descifradas, solo en memoria del proceso (nunca Redis, disco ni logs).
 *
 * Invariantes de seguridad:
 * - Una entrada se expulsa por TTL o por límite de usos, lo que ocurra primero.
 * - Al expulsarse, el buffer se sobrescribe con ceros (mejor esfuerzo: Node no garantiza borrado).
 * - Peticiones concurrentes por la misma clave comparten una sola carga (single-flight).
 * - La clave se entrega solo dentro de `withKey`, de forma síncrona respecto a la validación de la
 *   entrada, para que una expulsión no pueda poner a ceros una clave en uso.
 */
export class DekCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly maxUses: number;
  private readonly maxEntries: number;

  constructor(options: DekCacheOptions) {
    this.clock = options.clock;
    this.ttlMs = options.ttlMs ?? DEFAULT_DEK_TTL_MS;
    this.maxUses = options.maxUses ?? DEFAULT_DEK_MAX_USES;
    this.maxEntries = options.maxEntries ?? DEFAULT_DEK_MAX_ENTRIES;
  }

  async withKey<T>(
    cacheKey: string,
    load: () => Promise<Uint8Array>,
    use: (key: Uint8Array) => T,
  ): Promise<T> {
    for (;;) {
      // Si la entrada vigente existe, se usa sin ceder el control (sin `await` intermedio).
      const hit = this.takeValid(cacheKey);
      if (hit !== null) return use(hit.key);

      let inflight = this.pending.get(cacheKey);
      if (inflight === undefined) {
        inflight = load()
          .then((key) => {
            this.install(cacheKey, key);
          })
          .finally(() => {
            this.pending.delete(cacheKey);
          });
        this.pending.set(cacheKey, inflight);
      }
      await inflight;
      // Se vuelve a validar: si otra llamada expulsó la entrada entre medias (TTL o límite de usos),
      // se recarga en lugar de usar una clave que pudo quedar en ceros.
    }
  }

  /** Sobrescribe y olvida todas las claves (por ejemplo, al apagar el servicio). */
  clear(): void {
    for (const entry of this.entries.values()) entry.key.fill(0);
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private takeValid(cacheKey: string): Entry | null {
    const entry = this.entries.get(cacheKey);
    if (entry === undefined) return null;
    if (this.clock.now().getTime() >= entry.expiresAt || entry.uses >= this.maxUses) {
      this.evict(cacheKey);
      return null;
    }
    entry.uses += 1;
    // Reinsertar mantiene el orden LRU.
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return entry;
  }

  private install(cacheKey: string, key: Uint8Array): void {
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.evict(oldest.value);
    }
    this.entries.set(cacheKey, {
      key,
      expiresAt: this.clock.now().getTime() + this.ttlMs,
      uses: 0,
    });
  }

  private evict(cacheKey: string): void {
    const entry = this.entries.get(cacheKey);
    if (entry === undefined) return;
    entry.key.fill(0);
    this.entries.delete(cacheKey);
  }
}
