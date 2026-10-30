import {
  accountSchema,
  credentialSchema,
  credentialUsernameSchema,
  passwordVersionSchema,
  revealedPasswordSchema,
  type ChangeCredentialPasswordRequest,
  type CreateCredentialRequest,
} from '@iam/contracts';
import { z } from 'zod';

import { apiClient, type ApiClient } from '../../../shared/api';

/**
 * Fábrica de claves de las credenciales (docs/frontend.md §7.3). En la caché solo hay metadatos
 * (nombre, tipo, fechas, versiones): jamás un usuario ni una contraseña. Esos valores se piden con
 * funciones que NO pasan por Query (`fetchCredentialUsername` y `revealCredentialPassword`).
 */
export const credentialsKeys = {
  all: ['credentials'] as const,
  account: (accountId: string) => [...credentialsKeys.all, 'account', accountId] as const,
  list: (accountId: string) => [...credentialsKeys.all, 'list', accountId] as const,
  history: (credentialId: string) => [...credentialsKeys.all, 'history', credentialId] as const,
};

const credentialsResponseSchema = z.object({ data: z.array(credentialSchema) });
const historyResponseSchema = z.object({ data: z.array(passwordVersionSchema) });

/** `GET /accounts/:id`: nombre y `myLevel` de la cuenta, que deciden qué acciones se ofrecen. */
export function fetchAccount(
  accountId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  return client.get(`/accounts/${accountId}`, accountSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/** `GET /accounts/:id/credentials`: metadatos de las credenciales, completos y sin paginar. */
export async function fetchCredentials(
  accountId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get(
    `/accounts/${accountId}/credentials`,
    credentialsResponseSchema,
    { ...(signal === undefined ? {} : { signal }) },
  );
  return response.data;
}

/** `POST /accounts/:id/credentials` (exige `credential.create` y nivel EDIT). */
export function createCredential(
  accountId: string,
  body: CreateCredentialRequest,
  client: ApiClient = apiClient,
) {
  return client.post(`/accounts/${accountId}/credentials`, credentialSchema, { body });
}

/** `POST /credentials/:id/password` (exige `credential.update` y nivel EDIT): crea una versión nueva. */
export function changeCredentialPassword(
  credentialId: string,
  body: ChangeCredentialPasswordRequest,
  client: ApiClient = apiClient,
) {
  return client.post(`/credentials/${credentialId}/password`, credentialSchema, { body });
}

/** `GET /credentials/:id/history` (nivel EDIT): versiones sin contenido. */
export async function fetchCredentialHistory(
  credentialId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get(`/credentials/${credentialId}/history`, historyResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/**
 * `POST /credentials/:id/versions/:version/restore` (exige `credential.restore_version` y nivel EDIT). Sin
 * cuerpo: el servidor crea una versión nueva con la contraseña de la elegida y devuelve solo los
 * metadatos de la credencial, nunca el contenido.
 */
export function restoreCredentialVersion(
  credentialId: string,
  version: number,
  client: ApiClient = apiClient,
) {
  return client.post(
    `/credentials/${credentialId}/versions/${String(version)}/restore`,
    credentialSchema,
  );
}

/**
 * `POST /credentials/:id/username` (nivel USE, auditado). Devuelve el usuario al llamador y nada
 * más: quien lo use debe copiarlo y soltarlo, sin guardarlo en estado ni en la caché.
 */
export async function fetchCredentialUsername(
  credentialId: string,
  client: ApiClient = apiClient,
): Promise<string> {
  const response = await client.post(
    `/credentials/${credentialId}/username`,
    credentialUsernameSchema,
  );
  return response.username;
}

/**
 * `POST /credentials/:id/reveal` (nivel VIEW y permiso `credential.reveal_password`; el cliente
 * HTTP gestiona la reautenticación). Se llama con `useAsyncAction`, nunca con `useMutation`: la
 * caché de mutaciones conservaría la contraseña en `data` (docs/frontend.md §9).
 */
export async function revealCredentialPassword(
  credentialId: string,
  reason: string,
  client: ApiClient = apiClient,
): Promise<string> {
  const response = await client.post(
    `/credentials/${credentialId}/reveal`,
    revealedPasswordSchema,
    { body: { reason } },
  );
  return response.password;
}
