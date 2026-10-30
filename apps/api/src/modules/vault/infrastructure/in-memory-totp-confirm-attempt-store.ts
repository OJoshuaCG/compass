import type { TotpConfirmAttemptStore } from '../application/ports/totp-confirm-attempt-store.js';

/** Tope de llaves en memoria: evita que el mapa crezca sin límite con registros abandonados. */
const MAX_TRACKED_REGISTRATIONS = 10_000;

/**
 * Almacén en memoria del proceso. Con varias instancias cada una contaría por separado; el adaptador de
 * Redis (un `INCR` atómico) lo volverá global y sobrevivirá a reinicios, igual que el de ingreso.
 * Al llegar al tope se descartan las llaves más antiguas (orden de inserción del mapa).
 */
export class InMemoryTotpConfirmAttemptStore implements TotpConfirmAttemptStore {
  private readonly failuresByKey = new Map<string, number>();

  failures(key: string): Promise<number> {
    return Promise.resolve(this.failuresByKey.get(key) ?? 0);
  }

  recordFailure(key: string): Promise<void> {
    const previousFailures = this.failuresByKey.get(key) ?? 0;
    this.failuresByKey.set(key, previousFailures + 1);
    this.evictOldestBeyondLimit();
    return Promise.resolve();
  }

  clear(key: string): Promise<void> {
    this.failuresByKey.delete(key);
    return Promise.resolve();
  }

  private evictOldestBeyondLimit(): void {
    while (this.failuresByKey.size > MAX_TRACKED_REGISTRATIONS) {
      const oldestKey = this.failuresByKey.keys().next().value;
      if (oldestKey === undefined) return;
      this.failuresByKey.delete(oldestKey);
    }
  }
}
