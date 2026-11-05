import { AlertSettingsPage } from '../features/integrations';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

/**
 * Container de ruta de `/alerts`. Sin `alerts.infra.manage` responde como una ruta inexistente (no
 * revela la pantalla); es solo comodidad, porque el backend decide siempre.
 */
export function AlertsRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return me.permissions.includes('alerts.infra.manage') ? <AlertSettingsPage /> : <NotFoundPage />;
}
