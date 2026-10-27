/**
 * Retraso progresivo y bloqueo TEMPORAL tras intentos fallidos (plan: "Protección contra
 * ataques"). Nunca es un bloqueo permanente: así nadie puede dejar fuera a otra persona de forma
 * indefinida enviando contraseñas erróneas.
 *
 * - 0 a 2 fallos recientes: sin espera.
 * - 3 a 9 fallos: espera creciente (1 s, 2 s, 4 s … 64 s) desde el último fallo.
 * - 10 o más fallos: bloqueo de 15 minutos desde el último fallo.
 * - Pasados 15 minutos sin fallar, el contador se reinicia.
 */
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const THROTTLE_LOCK_THRESHOLD = 10;
const FREE_ATTEMPTS = 3;

export type ThrottleStatus =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number };

export function throttleStatus(
  failures: number,
  lastFailureAt: Date | null,
  now: Date,
): ThrottleStatus {
  if (failures < FREE_ATTEMPTS || lastFailureAt === null) return { allowed: true };
  const elapsed = now.getTime() - lastFailureAt.getTime();
  if (elapsed >= THROTTLE_WINDOW_MS) return { allowed: true };
  const wait =
    failures >= THROTTLE_LOCK_THRESHOLD
      ? THROTTLE_WINDOW_MS
      : 1000 * 2 ** (failures - FREE_ATTEMPTS);
  return elapsed >= wait ? { allowed: true } : { allowed: false, retryAfterMs: wait - elapsed };
}
