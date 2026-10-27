import { ErrorCode, passkeySchema } from '@iam/contracts';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type { z } from 'zod';

import { ApiError, apiClient, type ApiClient } from '../../../shared/api';
import {
  isAlreadyRegistered,
  isCeremonyCancelled,
  webauthnOptionsSchema,
  loadWebAuthn,
} from '../../../shared/lib/webauthn';

// Solo tipos: la biblioteca de WebAuthn no entra al JavaScript inicial (se importa al registrar).
const creationOptionsSchema =
  webauthnOptionsSchema as unknown as z.ZodType<PublicKeyCredentialCreationOptionsJSON>;

export type RegisterPasskeyResult =
  | { kind: 'registered'; name: string }
  | { kind: 'cancelled' }
  /** El servidor no da más opciones: se alcanzó el máximo de passkeys por persona. */
  | { kind: 'limit' }
  /** Este autenticador ya tiene una credencial de la cuenta. */
  | { kind: 'alreadyRegistered' };

/**
 * Ceremonia de registro: opciones, solicitud del navegador y verificación. Las opciones y la
 * atestación viven solo en variables locales de esta función; no pasan por la caché de Query.
 * La reautenticación (403 `AUTHZ.REAUTH_REQUIRED`) la resuelve el cliente HTTP y reintenta.
 */
export async function registerPasskey(
  name: string,
  client: ApiClient = apiClient,
): Promise<RegisterPasskeyResult> {
  const { startRegistration } = await loadWebAuthn();

  let optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  try {
    optionsJSON = await client.post('/me/passkeys/registration/options', creationOptionsSchema);
  } catch (error) {
    // El servidor rechaza las opciones con 422 al superar el máximo de passkeys.
    if (
      error instanceof ApiError &&
      error.status === 422 &&
      error.code === ErrorCode.VALIDATION_FAILED
    )
      return { kind: 'limit' };
    throw error;
  }

  let response: RegistrationResponseJSON;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (error) {
    if (isCeremonyCancelled(error)) return { kind: 'cancelled' };
    if (isAlreadyRegistered(error)) return { kind: 'alreadyRegistered' };
    throw error;
  }

  const created = await client.post('/me/passkeys/registration/verify', passkeySchema, {
    body: { name, response },
  });
  return { kind: 'registered', name: created.name };
}
