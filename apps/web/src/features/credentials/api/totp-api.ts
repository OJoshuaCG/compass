import {
  credentialTotpSchema,
  exportedTotpSchema,
  totpCodeSchema,
  type CredentialTotp,
  type ExportedTotp,
  type TotpCode,
} from '@iam/contracts';

import { ApiError, apiClient, type ApiClient } from '../../../shared/api';

import { credentialsKeys } from './credentials-api';

/**
 * Claves del segundo factor. Solo existe la del estado, que son metadatos (algoritmo, dígitos,
 * periodo, fechas y si se expuso). Los códigos, el enlace y la clave NO tienen clave de consulta:
 * se piden con funciones que no pasan por Query (docs/frontend.md §9).
 */
export const totpKeys = {
  status: (credentialId: string) => [...credentialsKeys.all, 'totp', credentialId] as const,
};

const HTTP_NOT_FOUND = 404;

/**
 * `GET /credentials/:id/totp` (nivel USE y permiso `credential.use_totp`). Devuelve `null` cuando la
 * credencial no tiene segundo factor: el servidor lo responde con 404 y para la pantalla es un
 * estado normal, no un error.
 */
export async function fetchTotpStatus(
  credentialId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<CredentialTotp | null> {
  try {
    return await client.get(`/credentials/${credentialId}/totp`, credentialTotpSchema, {
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) return null;
    throw error;
  }
}

/**
 * `POST /credentials/:id/totp` (nivel EDIT y permiso `credential.update`). El enlace lleva la clave:
 * se llama con `useAsyncAction`, nunca con `useMutation`, que guardaría el cuerpo en la caché de
 * mutaciones. La respuesta es solo el estado.
 */
export function registerTotp(
  credentialId: string,
  otpauthUri: string,
  client: ApiClient = apiClient,
): Promise<CredentialTotp> {
  return client.post(`/credentials/${credentialId}/totp`, credentialTotpSchema, {
    body: { otpauthUri },
  });
}

/** `POST /credentials/:id/totp/confirm` (nivel EDIT): el código que muestra la plataforma. */
export function confirmTotp(
  credentialId: string,
  code: string,
  client: ApiClient = apiClient,
): Promise<CredentialTotp> {
  return client.post(`/credentials/${credentialId}/totp/confirm`, credentialTotpSchema, {
    body: { code },
  });
}

/**
 * `POST /credentials/:id/totp/code` (nivel USE y permiso `credential.use_totp`, con tope por
 * minuto y auditado). Devuelve el código al llamador y nada más: vive solo en su estado local.
 */
export function issueTotpCode(
  credentialId: string,
  client: ApiClient = apiClient,
): Promise<TotpCode> {
  return client.post(`/credentials/${credentialId}/totp/code`, totpCodeSchema);
}

/**
 * `POST /credentials/:id/totp/export` (nivel MANAGE y permiso `credential.export_totp`, con motivo
 * escrito; el cliente HTTP gestiona la reautenticación). Entrega el enlace y la clave: solo con
 * `useAsyncAction`, igual que la revelación de una contraseña.
 */
export function exportTotpSecret(
  credentialId: string,
  reason: string,
  client: ApiClient = apiClient,
): Promise<ExportedTotp> {
  return client.post(`/credentials/${credentialId}/totp/export`, exportedTotpSchema, {
    body: { reason },
  });
}

/** `POST /credentials/:id/totp/retire` (nivel EDIT): apaga el segundo factor. */
export function retireTotp(
  credentialId: string,
  client: ApiClient = apiClient,
): Promise<CredentialTotp> {
  return client.post(`/credentials/${credentialId}/totp/retire`, credentialTotpSchema);
}
