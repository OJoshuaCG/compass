import { getRouteApi } from '@tanstack/react-router';
import { z } from 'zod';

import { InboundViewSharesPage } from '../features/inbound-codes';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

const route = getRouteApi('/_app/inbound/views/$viewId/shares');

/**
 * Container de ruta de `/inbound/views/:viewId/shares`. Un identificador que no es UUID responde
 * como una ruta inexistente sin llamar a la API; el permiso y el nivel los decide el servidor.
 */
export function InboundViewSharesRoute() {
  const me = useMe();
  const { viewId } = route.useParams();
  if (me === undefined) return null;
  if (!z.uuid().safeParse(viewId).success) return <NotFoundPage />;
  return <InboundViewSharesPage viewId={viewId} />;
}
