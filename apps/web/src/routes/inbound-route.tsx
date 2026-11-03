import { InboundViewsPage } from '../features/inbound-codes';
import { useMe } from '../shared/auth';

/**
 * Container de ruta de `/inbound`. El permiso `inbound.read_codes` solo decide si el enlace de la
 * navegación se ofrece; el listado lo autoriza el servidor.
 */
export function InboundRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return <InboundViewsPage />;
}
