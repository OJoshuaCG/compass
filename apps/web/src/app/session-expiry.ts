import type { QueryClient } from '@tanstack/react-query';

import { onSessionExpired } from '../shared/api';

import type { createAppRouter } from './router';

/**
 * 401 fuera de un flujo de credenciales = la sesión se perdió (docs/frontend.md §7.2): se
 * descarta TODO el estado en caché (puede incluir datos de la sesión anterior) y se redirige
 * al login conservando la ruta de retorno. Devuelve la función que quita la suscripción.
 */
export function bindSessionExpiry(
  router: ReturnType<typeof createAppRouter>,
  queryClient: QueryClient,
): () => void {
  return onSessionExpired(() => {
    const { pathname, href } = router.state.location;
    if (pathname === '/login') return;
    queryClient.clear();
    void router.navigate({ to: '/login', search: { returnTo: href }, replace: true });
  });
}
