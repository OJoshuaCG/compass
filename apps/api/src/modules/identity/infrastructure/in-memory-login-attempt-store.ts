import type { LoginAttemptStore } from '../application/ports/identity-ports.js';
import { THROTTLE_WINDOW_MS, throttleStatus } from '../domain/throttle-policy.js';
import type { ThrottleStatus } from '../domain/throttle-policy.js';

interface Entry {
  attempts: number;
  lastAttemptAt: Date;
}

/**
 * Almacén en memoria del proceso. `consume` es síncrono por dentro (sin `await` entre decidir y
 * contar), así que en un mismo proceso una ráfaga de intentos en paralelo no puede colarse. Con
 * varias instancias cada una cuenta por separado; el adaptador de Redis (un `INCR` atómico) lo
 * vuelve global y sobrevive a reinicios.
 */
export class InMemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly entries = new Map<string, Entry>();

  consume(key: string, at: Date): Promise<ThrottleStatus> {
    const entry = this.entries.get(key);
    const stale =
      entry !== undefined && at.getTime() - entry.lastAttemptAt.getTime() > THROTTLE_WINDOW_MS;
    const attempts = entry === undefined || stale ? 0 : entry.attempts;
    const status = throttleStatus(attempts, entry?.lastAttemptAt ?? null, at);
    if (status.allowed) {
      // Un intento bloqueado no cuenta ni mueve la ventana: el bloqueo termina en su fecha.
      this.entries.set(key, { attempts: attempts + 1, lastAttemptAt: at });
      this.prune(at);
    }
    return Promise.resolve(status);
  }

  reset(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  /** Evita que el mapa crezca sin límite con claves que nunca vuelven. */
  private prune(now: Date): void {
    if (this.entries.size < 10_000) return;
    for (const [key, entry] of this.entries) {
      if (now.getTime() - entry.lastAttemptAt.getTime() > THROTTLE_WINDOW_MS) {
        this.entries.delete(key);
      }
    }
  }
}
