import {
  isValidRevealReason,
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
} from '@iam/contracts';

const MILLISECONDS_PER_SECOND = 1000;

/** Una contraseña revelada se vuelve a ocultar a los 30 s (docs/business/vault.md §7.2). */
export const REVEALED_PASSWORD_VISIBLE_MS = 30_000;

/** Un secreto copiado se borra del portapapeles a los 30 s, si todavía lo contiene (mejor esfuerzo). */
export const CLIPBOARD_CLEAR_MS = 30_000;

/** Los textos reciben los segundos como variable: el número nunca se escribe a mano en el catálogo. */
export const REVEALED_PASSWORD_VISIBLE_SECONDS =
  REVEALED_PASSWORD_VISIBLE_MS / MILLISECONDS_PER_SECOND;
export const CLIPBOARD_CLEAR_SECONDS = CLIPBOARD_CLEAR_MS / MILLISECONDS_PER_SECOND;

export { REVEAL_REASON_MAX_LENGTH, REVEAL_REASON_MIN_LENGTH };

/**
 * Largo del motivo tal como lo cuenta el servidor: después de recortar espacios. Así el contador
 * que ve la persona coincide con la regla que decide si se descifra o se niega.
 */
export function revealReasonLength(reason: string): number {
  return reason.trim().length;
}

export function isRevealReasonValid(reason: string): boolean {
  return isValidRevealReason(reason);
}
