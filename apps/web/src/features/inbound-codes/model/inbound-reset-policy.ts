import { isValidRevealReason, REVEAL_REASON_MAX_LENGTH, REVEAL_REASON_MIN_LENGTH } from '@iam/contracts';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Un restablecimiento revelado se vuelve a ocultar a los 30 s, igual que una contraseña revelada
 * (docs/business/vault.md §7.2): quien lo pidió ya tuvo tiempo de usarlo y no queda a la vista.
 */
export const REVEALED_RESET_VISIBLE_MS = 30_000;
export const REVEALED_RESET_VISIBLE_SECONDS = REVEALED_RESET_VISIBLE_MS / MILLISECONDS_PER_SECOND;

export { REVEAL_REASON_MAX_LENGTH, REVEAL_REASON_MIN_LENGTH };

/** Largo del motivo como lo cuenta el servidor (después de recortar), para que el contador no engañe. */
export function revealReasonLength(reason: string): number {
  return reason.trim().length;
}

/** La misma regla del servidor; el servidor la vuelve a aplicar y audita la negación. */
export function isRevealReasonValid(reason: string): boolean {
  return isValidRevealReason(reason);
}
