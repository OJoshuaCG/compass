import { CredentialHealthSummaryPage } from '../features/credentials';

/**
 * Container de ruta de `/credential-health`. El permiso `credential.view_health` solo decide si el
 * enlace de la navegación se ofrece; cada panel lo autoriza el servidor.
 */
export function CredentialHealthRoute() {
  return <CredentialHealthSummaryPage />;
}
