import type { UserId } from '../../../../shared/kernel/index.js';

/**
 * Lo que la baja le quita a la persona que se va en la bóveda y en los grupos (governance §2.1, paso 3).
 * El adaptador vive en `vault`: `directory` no importa la bóveda. Todo corre en la transacción de la baja.
 */
export interface OffboardingAccessCleanup {
  /**
   * Cuentas no archivadas donde la persona tiene acceso de VER o más (directo o por grupo). Debe leerse
   * ANTES de retirar comparticiones y grupos: después ya no queda rastro de ese acceso.
   */
  listAccountsWithViewOrMoreAccess(userId: UserId): Promise<readonly string[]>;
  /** Revoca las comparticiones directas vivas de la persona. No toca las que ella otorgó a otros. */
  revokeDirectShares(input: {
    readonly userId: UserId;
    readonly revokedBy: UserId;
  }): Promise<number>;
  /** La saca de todos los grupos. */
  removeFromAllGroups(userId: UserId): Promise<number>;
}
