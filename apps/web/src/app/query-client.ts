import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '../shared/api';

/**
 * Valores por defecto de Query: `staleTime` explícito y sin reintentos para errores 4xx
 * (reintentar un 403 o 404 no cambia el resultado). Los secretos revelados NO pasan por esta
 * caché (docs/frontend.md §9).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          const clientError =
            error instanceof ApiError && error.status >= 400 && error.status < 500;
          return !clientError && failureCount < 2;
        },
      },
    },
  });
}
