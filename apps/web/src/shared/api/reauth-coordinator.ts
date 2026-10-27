/**
 * Coordina la reautenticación (step-up) entre el cliente HTTP y el diálogo (docs/frontend.md §7.2).
 * Si varias peticiones reciben `AUTHZ.REAUTH_REQUIRED` a la vez comparten una sola petición de
 * código: el usuario ve un solo diálogo y todas se reintentan con el mismo resultado.
 * Es un almacén externo mínimo (sin Query ni contexto) para que el cliente HTTP, que no es React,
 * pueda abrir el diálogo sin depender de la UI.
 */
export type ReauthCoordinator = {
  /** Pide reautenticar. Resuelve `true` si el usuario lo logró y `false` si canceló. */
  request: () => Promise<boolean>;
  /** Cierra la petición en curso (la llama el diálogo al terminar o cancelar). */
  settle: (result: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  isOpen: () => boolean;
};

export function createReauthCoordinator(): ReauthCoordinator {
  const listeners = new Set<() => void>();
  let pending: { promise: Promise<boolean>; resolve: (result: boolean) => void } | null = null;

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    request: () => {
      if (pending !== null) return pending.promise;
      let resolve: (result: boolean) => void = () => undefined;
      const promise = new Promise<boolean>((res) => {
        resolve = res;
      });
      pending = { promise, resolve };
      notify();
      return promise;
    },
    settle: (result) => {
      const current = pending;
      if (current === null) return;
      pending = null;
      current.resolve(result);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOpen: () => pending !== null,
  };
}

/** Instancia única de la app. */
export const reauthCoordinator = createReauthCoordinator();
