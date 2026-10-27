import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';

import { isCeremonyCancelled, loadWebAuthn } from '../../../shared/lib/webauthn';
import type { createAuthApi } from './auth-api';

export type PasskeySignInResult = 'verified' | 'cancelled';

/**
 * Ceremonia de ingreso con passkey: opciones del servidor, solicitud del navegador y verificación.
 * La biblioteca se descarga aquí y no antes. Que la persona cierre la solicitud del navegador no
 * es un error del servidor: se devuelve `cancelled` para que la pantalla lo avise en neutro.
 * Cualquier otro fallo (red, 401, 429, soporte del navegador) se propaga tal cual.
 */
export async function signInWithPasskey(
  api: Pick<ReturnType<typeof createAuthApi>, 'passkeyOptions' | 'passkeyVerify'>,
): Promise<PasskeySignInResult> {
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
