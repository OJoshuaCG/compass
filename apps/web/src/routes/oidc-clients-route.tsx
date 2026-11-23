import { OidcClientsPage } from '../features/oidc-clients';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

/**
 * Container de ruta de `/sso/clients`. Sin `sso.clients.manage` responde como una ruta inexistente
 * (no revela la pantalla); es solo comodidad, porque el backend decide siempre.
 */
export function OidcClientsRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return me.permissions.includes('sso.clients.manage') ? <OidcClientsPage /> : <NotFoundPage />;
}
