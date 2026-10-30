import type { TotpConfirmAttemptStore } from '../application/ports/totp-confirm-attempt-store.js';
import { INITIAL_TOTP_CONFIRM_LOCK_STATE } from '../domain/totp-confirm-lock.js';
import type { TotpConfirmLockState } from '../domain/totp-confirm-lock.js';

/** Tope de llaves en memoria: evita que el mapa crezca sin límite con registros abandonados. */
const MAX_TRACKED_REGISTRATIONS = 10_000;

/**
 * Almacén en memoria del proceso. Con varias instancias cada una contaría por separado; el adaptador de
 * Redis lo volverá global y sobrevivirá a reinicios, igual que el de ingreso.
 * Al llegar al tope se descartan las llaves menos recientemente escritas (orden de inserción del mapa, que
 * se refresca en cada `save`).
 */
export class InMemoryTotpConfirmAttemptStore implements TotpConfirmAttemptStore {
  private readonly stateByKey = new Map<string, TotpConfirmLockState>();

  state(key: string): Promise<TotpConfirmLockState> {
    return Promise.resolve(this.stateByKey.get(key) ?? INITIAL_TOTP_CONFIRM_LOCK_STATE);
  }

  save(key: string, state: TotpConfirmLockState): Promise<void> {
    // Se borra antes de escribir para que la llave pase al final del orden de inserción.
    this.stateByKey.delete(key);
    this.stateByKey.set(key, state);
    this.evictOldestBeyondLimit();
    return Promise.resolve();
  }

  clear(key: string): Promise<void> {
    this.stateByKey.delete(key);
    return Promise.resolve();
  }

  private evictOldestBeyondLimit(): void {
    while (this.stateByKey.size > MAX_TRACKED_REGISTRATIONS) {
      const oldestKey = this.stateByKey.keys().next().value;
      if (oldestKey === undefined) return;
      this.stateByKey.delete(oldestKey);
    }
  }
}
