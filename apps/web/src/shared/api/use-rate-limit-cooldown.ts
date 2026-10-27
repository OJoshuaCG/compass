import { useEffect, useState } from 'react';

import { ApiError } from './api-error';

/** Espera por defecto si el 429 no trae `Retry-After`. */
const DEFAULT_COOLDOWN_SECONDS = 10;

/**
 * Ante un 429 devuelve los segundos que faltan para poder reintentar (docs/frontend.md §7.2):
 * la pantalla deshabilita el envío mientras `secondsLeft > 0`. Con cualquier otro error, o sin
 * error, devuelve 0.
 */
export function useRateLimitCooldown(error: unknown): { secondsLeft: number } {
  const total =
    error instanceof ApiError && error.status === 429
      ? (error.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS)
      : 0;
  // El contador va ligado al error que lo originó: un error nuevo reinicia la cuenta sin
  // tener que sincronizar estado desde un efecto.
  const [elapsed, setElapsed] = useState<{ error: unknown; seconds: number }>({
    error: undefined,
    seconds: 0,
  });

  useEffect(() => {
    if (total === 0) return;
    let seconds = 0;
    const id = window.setInterval(() => {
      seconds += 1;
      setElapsed({ error, seconds });
      if (seconds >= total) window.clearInterval(id);
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [error, total]);

  const done = elapsed.error === error ? elapsed.seconds : 0;
  return { secondsLeft: Math.max(0, total - done) };
}
