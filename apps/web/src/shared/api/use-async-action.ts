import { useRef, useState } from 'react';

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

  return {
    pending: state.pending,
    error: state.error,
    reset: () => {
      setState({ pending: false, error: undefined });
    },
    run: async (...args) => {
      if (inFlight.current) return { ok: false, error: new Error('Action already in progress') };
      inFlight.current = true;
      setState({ pending: true, error: undefined });
      try {
        const value = await action(...args);
        setState({ pending: false, error: undefined });
        return { ok: true, value };
      } catch (error) {
        setState({ pending: false, error });
        return { ok: false, error };
      } finally {
        inFlight.current = false;
      }
    },
  };
}
