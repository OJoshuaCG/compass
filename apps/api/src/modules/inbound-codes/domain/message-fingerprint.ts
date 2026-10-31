/**
 * Deduplicación por huella (ADR 0045 sección 3, IC-1).
 *
 * La huella es un hash que quien llama ya calculó sobre el identificador del mensaje del proveedor (este
 * módulo no hace criptografía). Aquí solo se valida su forma y se compara con las huellas conocidas; la
 * restricción única de la base de datos (IC-2b) sigue siendo la barrera definitiva ante concurrencia.
 */
import { isVisibleAsciiOnly } from './ascii-text.js';
import { MAX_FINGERPRINT_LENGTH } from './inbound-limits.js';

export type DeduplicationDecision = 'new' | 'duplicate' | 'invalid_fingerprint';

export function decideDeduplication(
  fingerprint: string,
  knownFingerprints: ReadonlySet<string>,
): DeduplicationDecision {
  const hasUsableShape =
    fingerprint.length > 0 &&
    fingerprint.length <= MAX_FINGERPRINT_LENGTH &&
    isVisibleAsciiOnly(fingerprint);
  if (!hasUsableShape) return 'invalid_fingerprint';
  return knownFingerprints.has(fingerprint) ? 'duplicate' : 'new';
}
