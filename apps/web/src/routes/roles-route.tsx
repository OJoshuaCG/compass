import { RolesPage } from '../features/roles';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

/**
 * Container de ruta de `/roles`. Sin `role.manage` responde como una ruta inexistente (no revela
 * la pantalla); es solo comodidad, porque el backend decide siempre.
 */
export function RolesRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return me.permissions.includes('role.manage') ? <RolesPage /> : <NotFoundPage />;
}
