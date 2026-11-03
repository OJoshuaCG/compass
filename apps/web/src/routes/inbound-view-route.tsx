import { getRouteApi } from '@tanstack/react-router';
import { z } from 'zod';

import { InboundViewPage } from '../features/inbound-codes';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

const route = getRouteApi('/_app/inbound/views/$viewId');

/**
 * Container de ruta de `/inbound/views/:viewId`. Un identificador que no es UUID responde como una
 * ruta inexistente sin llamar a la API; el acceso a la vista lo decide el servidor.
 */
export function InboundViewRoute() {
  const me = useMe();
  const { viewId } = route.useParams();
  if (me === undefined) return null;
  if (!z.uuid().safeParse(viewId).success) return <NotFoundPage />;
  return <InboundViewPage viewId={viewId} />;
}
