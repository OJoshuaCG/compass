/** Fallos tras los cuales el evento deja de reintentarse y queda para inspección (dead letter). */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Espera tras el primer fallo; se duplica en cada fallo siguiente. */
export const OUTBOX_BACKOFF_BASE_MS = 30 * 1000;

/** Tope de la espera: sin él, el sexto reintento esperaría horas y un fallo transitorio se eternizaría. */
export const OUTBOX_BACKOFF_CAP_MS = 60 * 60 * 1000;

/**
 * Plazo máximo de un manejador por evento. Sin él, un manejador colgado retendría la transacción
 * (y el bloqueo de fila) para siempre, congelaría al trabajador y haría que el apagado ordenado
 * nunca terminara. Vencido el plazo se trata como un fallo más del manejador.
 */
export const OUTBOX_HANDLER_TIMEOUT_MS = 30 * 1000;

/**
 * Espera antes del siguiente intento, dado el número de fallos acumulados (>= 1):
 * 30 s, 1 min, 2 min, 4 min... con tope de 1 h.
 */
export function computeBackoffMs(failedAttempts: number): number {
  const exponent = Math.max(failedAttempts - 1, 0);
  return Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** exponent, OUTBOX_BACKOFF_CAP_MS);
}

export function hasExhaustedAttempts(failedAttempts: number): boolean {
  return failedAttempts >= OUTBOX_MAX_ATTEMPTS;
}
