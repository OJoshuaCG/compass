import type { TotpConfirmLockState } from '../../domain/totp-confirm-lock.js';

/**
 * Guarda el estado de bloqueo al confirmar un registro pendiente del segundo factor: fallos consecutivos,
 * nivel de escalamiento y fin del bloqueo. La llave identifica el registro (credencial y versión del
 * secreto), no a la persona: quien registró de nuevo empieza con todo en cero.
 *
 * La política (cuándo se bloquea y por cuánto) vive en el dominio (`totp-confirm-lock.ts`); el almacén solo
 * guarda y devuelve el estado. Los contadores viven en memoria del proceso hasta que haya Redis (igual que
 * los intentos de ingreso): se asume una sola instancia de la API y un reinicio los pone en cero.
 */
export interface TotpConfirmAttemptStore {
  /** Estado del registro; todo en cero si nunca falló. */
  state(key: string): Promise<TotpConfirmLockState>;
  save(key: string, state: TotpConfirmLockState): Promise<void>;
  /** Olvida el registro por completo: cuenta, escalamiento y bloqueo. */
  clear(key: string): Promise<void>;
}
