import {
  ErrorCode,
  acceptInvitationResponseSchema,
  invitationPreviewResponseSchema,
  loginResponseSchema,
  totpConfirmResponseSchema,
  totpEnrollResponseSchema,
} from '@iam/contracts';

import { ApiError, apiClient, noContentSchema, type ApiClient } from '../../../shared/api';

/**
 * El servidor responde esto en el registro y la verificación del segundo factor mientras la
 * contraseña inicial sigue sin cambiarse: la pantalla debe llevar a `/password/change`.
 */
export function isPasswordChangeRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED;
}

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
    changePassword: (input: { currentPassword: string; newPassword: string }) =>
      client.post('/auth/password/change', noContentSchema, { body: input }),
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
