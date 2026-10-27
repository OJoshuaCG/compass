import type { QueryClient } from '@tanstack/react-query';

import { onSessionExpired, reauthCoordinator } from '../shared/api';
import { announceSessionEnded, onSessionEndedElsewhere } from '../shared/auth';

import type { createAppRouter } from './router';

/**
 * 401 fuera de un flujo de credenciales = la sesión se perdió (docs/frontend.md §7.2): se
 * descarta TODO el estado en caché (puede incluir datos de la sesión anterior) y se redirige
 * al login conservando la ruta de retorno. Además avisa a las demás pestañas y atiende el mismo
 * aviso cuando viene de otra pestaña. Devuelve la función que quita las suscripciones.
 */
export function bindSessionExpiry(
  router: ReturnType<typeof createAppRouter>,
  queryClient: QueryClient,
): () => void {
  // Sin sesión no hay a quién reautenticar: se rechaza la solicitud pendiente (la operación
  // original falla en vez de quedar colgada) y el diálogo se cierra antes de ir al login.
  const stopExpiry = onSessionExpired(() => {
    reauthCoordinator.settle(false);
    const { pathname, href } = router.state.location;
    if (pathname === '/login') return;
    queryClient.clear();
    announceSessionEnded();
    void router.navigate({ to: '/login', search: { returnTo: href }, replace: true });
  });
  // Otra pestaña terminó la sesión: solo se sale si ESTA está en el área autenticada (una persona
  // a mitad del ingreso o aceptando una invitación no debe perder lo que escribe). No se vuelve a
  // difundir: las demás pestañas ya recibieron el aviso original.
  const stopRemote = onSessionEndedElsewhere(() => {
    if (!router.state.matches.some((match) => match.routeId === '/_app')) return;
    reauthCoordinator.settle(false);
    queryClient.clear();
    void router.navigate({ to: '/login', replace: true });
  });
  return () => {
    stopExpiry();
    stopRemote();
  };
}
