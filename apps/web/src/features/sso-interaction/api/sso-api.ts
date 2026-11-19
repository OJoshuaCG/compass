import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { z } from 'zod';

import { apiClient, noContentSchema, type ApiClient } from '../../../shared/api';
import { webauthnOptionsSchema } from '../../../shared/lib/webauthn';

// Solo tipos: la biblioteca de WebAuthn no entra al JavaScript inicial (se importa al usar la llave).
const requestOptionsSchema =
  webauthnOptionsSchema as unknown as z.ZodType<PublicKeyCredentialRequestOptionsJSON>;

/**
 * Reautenticación que pide una aplicación OIDC (`prompt=login` / `max_age`). Son funciones y no
 * hooks de Query a propósito: el código y la aserción son secretos de un solo uso y no deben
 * quedar en la caché (docs/frontend.md §9).
 */
export function createSsoApi(client: ApiClient = apiClient) {
  return {
    reauthWithCode: (code: string) =>
      client.post('/auth/sso-reauth', noContentSchema, { body: { code } }),
    /** Opciones del reto de la llave de acceso (sesión completa, sin cuerpo). */
    passkeyOptions: () => client.post('/auth/reauth/passkey/options', requestOptionsSchema),
    passkeyVerify: (response: AuthenticationResponseJSON) =>
      client.post('/auth/sso-reauth/passkey/verify', noContentSchema, { body: { response } }),
  };
}

export const ssoApi = createSsoApi();
