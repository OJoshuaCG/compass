import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';

import { isCeremonyCancelled, loadWebAuthn } from '../../../shared/lib/webauthn';
import type { createSsoApi } from './sso-api';

export type PasskeyReauthResult = 'verified' | 'cancelled';

/**
 * Ceremonia de reautenticación con llave de acceso: opciones, solicitud del navegador y
 * verificación. Que la persona cierre la solicitud no es un fallo del servidor: se devuelve
 * `cancelled` para avisarlo en neutro. Cualquier otro fallo se propaga tal cual.
 */
export async function reauthenticateWithPasskey(
  api: Pick<ReturnType<typeof createSsoApi>, 'passkeyOptions' | 'passkeyVerify'>,
): Promise<PasskeyReauthResult> {
  const { startAuthentication } = await loadWebAuthn();
  const optionsJSON = await api.passkeyOptions();
  let response: AuthenticationResponseJSON;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (error) {
    if (isCeremonyCancelled(error)) return 'cancelled';
    throw error;
  }
  await api.passkeyVerify(response);
  return 'verified';
}
