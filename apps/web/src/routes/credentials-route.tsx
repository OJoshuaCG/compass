import { getRouteApi } from '@tanstack/react-router';
import { z } from 'zod';

import { CredentialsPage } from '../features/credentials';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

const route = getRouteApi('/_app/accounts/$accountId/credentials');

/**
 * Container de ruta de `/accounts/:accountId/credentials`. Un identificador que no es UUID responde
 * como una ruta inexistente sin llamar a la API; los permisos y el nivel los decide el servidor.
 */
export function CredentialsRoute() {
  const me = useMe();
  const { accountId } = route.useParams();
  if (me === undefined) return null;
  if (!z.uuid().safeParse(accountId).success) return <NotFoundPage />;
  return <CredentialsPage accountId={accountId} />;
}
