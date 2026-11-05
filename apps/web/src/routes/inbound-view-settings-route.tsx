import { InboundViewSettingsPage } from '../features/inbound-codes';
import { useMe } from '../shared/auth';

/**
 * Container de ruta de `/inbound/view-settings`. El permiso `inbound.configure` solo decide si el
 * enlace de la navegación se ofrece; el listado y cada cambio los autoriza el servidor.
 */
export function InboundViewSettingsRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return <InboundViewSettingsPage />;
}
