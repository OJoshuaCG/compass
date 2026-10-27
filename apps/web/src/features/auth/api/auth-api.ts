import {
  acceptInvitationResponseSchema,
  invitationPreviewResponseSchema,
  loginResponseSchema,
  totpConfirmResponseSchema,
  totpEnrollResponseSchema,
} from '@iam/contracts';

import { apiClient, noContentSchema, type ApiClient } from '../../../shared/api';

/**
 * Llamadas de autenticación. Son funciones simples y NO hooks de Query a propósito: sus
 * argumentos y resultados son secretos (contraseña, códigos, clave TOTP, token de invitación,
 * códigos de recuperación) y no deben quedar en la caché de Query (docs/frontend.md §9).
 * Los containers las ejecutan con `useAsyncAction`, cuyo estado vive solo en el componente.
 */
export function createAuthApi(client: ApiClient = apiClient) {
  return {
    login: (credentials: { email: string; password: string }) =>
      client.post('/auth/login', loginResponseSchema, { body: credentials }),
    verifyMfa: (code: string) =>
      client.post('/auth/mfa/verify', noContentSchema, { body: { code } }),
    useRecoveryCode: (code: string) =>
      client.post('/auth/mfa/recovery', noContentSchema, { body: { code } }),
    startEnrollment: () => client.post('/auth/mfa/totp/enroll', totpEnrollResponseSchema),
    confirmEnrollment: (code: string) =>
      client.post('/auth/mfa/totp/confirm', totpConfirmResponseSchema, { body: { code } }),
    previewInvitation: (token: string) =>
      client.post('/invitations/preview', invitationPreviewResponseSchema, { body: { token } }),
    acceptInvitation: (input: { token: string; displayName: string; password: string }) =>
      client.post('/invitations/accept', acceptInvitationResponseSchema, { body: input }),
  };
}

export const authApi = createAuthApi();
