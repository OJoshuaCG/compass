import type { SigningKeyStore, StoredSigningKey } from '../application/ports/signing-keys.js';

/** Almacén de claves de firma en memoria para pruebas unitarias. */
export class InMemorySigningKeyStore implements SigningKeyStore {
  private readonly active = new Map<string, StoredSigningKey>();

  listActive(): Promise<readonly StoredSigningKey[]> {
    return Promise.resolve([...this.active.values()]);
  }

  add(key: StoredSigningKey): Promise<void> {
    this.active.set(key.kid, key);
    return Promise.resolve();
  }

  retire(kid: string): Promise<boolean> {
    return Promise.resolve(this.active.delete(kid));
  }
}
