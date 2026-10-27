import { useCallback, useRef, useState } from 'react';

export type ActionResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

export type AsyncAction<A extends unknown[], R> = {
  run: (...args: A) => Promise<ActionResult<R>>;
  pending: boolean;
  /** Último error (se limpia al volver a ejecutar o con `reset`). */
  error: unknown;
  reset: () => void;
};

/**
 * Ejecuta una acción asíncrona con estado `pending`/`error` SIN pasar por la caché de TanStack
 * Query. Es deliberado: `useMutation` conserva `variables` y `data` en la caché de mutaciones
 * mientras el componente está montado, y aquí viajan contraseñas, códigos TOTP, claves de
 * enrolamiento y códigos de recuperación (docs/frontend.md §9: los secretos viven solo en el
 * estado del componente). También evita el doble envío mientras hay una acción en curso.
 */
export function useAsyncAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
): AsyncAction<A, R> {
  const [state, setState] = useState<{ pending: boolean; error: unknown }>({
    pending: false,
    error: undefined,
  });
  const inFlight = useRef(false);
  // Generación de la acción: `reset` la invalida y el resultado tardío de una ejecución
  // cancelada se ignora (ni toca el estado ni cuenta como éxito).
  const generation = useRef(0);

  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setState({ pending: false, error: undefined });
  }, []);

  return {
    pending: state.pending,
    error: state.error,
    reset,
    run: async (...args) => {
      if (inFlight.current) return { ok: false, error: new Error('Action already in progress') };
      inFlight.current = true;
      const mine = generation.current;
      const cancelled = (): ActionResult<never> => ({
        ok: false,
        error: new Error('Action cancelled'),
      });
      setState({ pending: true, error: undefined });
      try {
        const value = await action(...args);
        if (generation.current !== mine) return cancelled();
        setState({ pending: false, error: undefined });
        return { ok: true, value };
      } catch (error) {
        if (generation.current !== mine) return cancelled();
        setState({ pending: false, error });
        return { ok: false, error };
      } finally {
        // Solo la ejecución vigente libera el cerrojo; una cancelada ya lo liberó en `reset`.
        if (generation.current === mine) inFlight.current = false;
      }
    },
  };
}
