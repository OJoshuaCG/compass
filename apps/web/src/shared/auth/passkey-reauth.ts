import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { z } from 'zod';

import { apiClient, noContentSchema } from '../api';
import { isCeremonyCancelled, loadWebAuthn, webauthnOptionsSchema } from '../lib/webauthn';

export type PasskeyReauthResult = 'verified' | 'cancelled';

// Solo tipos: la biblioteca de WebAuthn no entra al JavaScript inicial (se importa al usar la passkey).
const requestOptionsSchema =
  webauthnOptionsSchema as unknown as z.ZodType<PublicKeyCredentialRequestOptionsJSON>;

/**
 * Reautenticación con llave de acceso (ADR 0033): opciones del servidor, solicitud del navegador y
 * verificación. Las peticiones llevan `skipReauth` para que un rechazo no reabra el diálogo que la
 * está pidiendo. Que la persona cierre la solicitud del navegador no es un error: se devuelve
 * `cancelled`. Cualquier otro fallo (red, 401, 429, soporte del navegador) se propaga tal cual.
 */
export async function reauthenticateWithPasskey(): Promise<PasskeyReauthResult> {
  const { startAuthentication } = await loadWebAuthn();
  const optionsJSON = await apiClient.post('/auth/reauth/passkey/options', requestOptionsSchema, {
    skipReauth: true,
  });
  let response: AuthenticationResponseJSON;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (error) {
    if (isCeremonyCancelled(error)) return 'cancelled';
    throw error;
  }
  await apiClient.post('/auth/reauth/passkey/verify', noContentSchema, {
    body: { response },
    skipReauth: true,
  });
  return 'verified';
}
