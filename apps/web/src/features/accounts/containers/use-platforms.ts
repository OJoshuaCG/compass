import { useQuery } from '@tanstack/react-query';

import { accountsKeys, fetchPlatforms } from '../api/accounts-api';

/** El catálogo de plataformas cambia poco: 5 minutos evitan pedirlo en cada pestaña o diálogo. */
const PLATFORMS_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Plataformas para nombrar la columna y llenar el selector de "Crear cuenta". Todas las pantallas
 * comparten la misma clave, así que una sola petición sirve a la tabla y al diálogo.
 */
export function usePlatforms() {
  return useQuery({
    queryKey: accountsKeys.platforms(),
    queryFn: ({ signal }) => fetchPlatforms(signal),
    staleTime: PLATFORMS_STALE_TIME_MS,
  });
}
