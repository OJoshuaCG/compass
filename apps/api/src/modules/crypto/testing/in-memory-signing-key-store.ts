import type { SigningKeyStore, StoredSigningKey } from '../application/ports/signing-keys.js';

/** Lo que el almacén real deja en `platform_audit_events` por cada cambio (migración 0047). */
export interface RecordedAuditEvent {
  readonly action: 'added' | 'retired';
  readonly kid: string;
  readonly actor: string;
}

/** Almacén de claves de firma en memoria para pruebas unitarias. */
export class InMemorySigningKeyStore implements SigningKeyStore {
  private readonly active = new Map<string, StoredSigningKey>();
  readonly auditEvents: RecordedAuditEvent[] = [];

  listActive(): Promise<readonly StoredSigningKey[]> {
    return Promise.resolve([...this.active.values()]);
  }

  add(key: StoredSigningKey, actor: string): Promise<void> {
    this.active.set(key.kid, key);
    this.auditEvents.push({ action: 'added', kid: key.kid, actor });
    return Promise.resolve();
  }

  retire(kid: string, actor: string): Promise<boolean> {
    const wasActive = this.active.delete(kid);
    // Como la base de datos: lo que no se retiró no se audita.
    if (wasActive) this.auditEvents.push({ action: 'retired', kid, actor });
    return Promise.resolve(wasActive);
  }
}
