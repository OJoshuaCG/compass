import { RootTransferPage } from '../features/directory';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

/** Rango máximo (número) que puede ver la transferencia de la Raíz: la Raíz y los Administradores. */
const MAX_RANK_TO_VIEW_ROOT_TRANSFER = 1;

/**
 * Container de ruta de `/root-transfer`. Quien tiene un rango menor responde como una ruta
 * inexistente (no revela la pantalla); es solo comodidad, porque el backend decide siempre.
 */
export function RootTransferRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return me.user.rank <= MAX_RANK_TO_VIEW_ROOT_TRANSFER ? <RootTransferPage /> : <NotFoundPage />;
}
