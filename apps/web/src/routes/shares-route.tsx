import { getRouteApi } from '@tanstack/react-router';
import { z } from 'zod';

import { SharesPage } from '../features/shares';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

const route = getRouteApi('/_app/accounts/$accountId/shares');

/**
 * Container de ruta de `/accounts/:accountId/shares`. Un identificador que no es UUID responde
 * como una ruta inexistente sin llamar a la API; el permiso y el nivel los decide el servidor.
 */
export function SharesRoute() {
  const me = useMe();
  const { accountId } = route.useParams();
  if (me === undefined) return null;
  if (!z.uuid().safeParse(accountId).success) return <NotFoundPage />;
  return <SharesPage accountId={accountId} />;
}
