import { oidcClientSchema, oidcClientWithSecretSchema } from '@iam/contracts';
import type { OidcClient, OidcClientWithSecret, RegisterOidcClientRequest } from '@iam/contracts';
import { z } from 'zod';

import { apiClient, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de las aplicaciones OIDC (docs/frontend.md §7.3). Solo el listado entra en Query. */
export const oidcClientsKeys = {
  all: ['oidc-clients'] as const,
  list: () => [...oidcClientsKeys.all, 'list'] as const,
};

const CLIENTS_PATH = '/sso/clients';

const clientsResponseSchema = z.object({ data: z.array(oidcClientSchema) });
const clientResponseSchema = z.object({ data: oidcClientSchema });
const clientWithSecretResponseSchema = z.object({ data: oidcClientWithSecretSchema });

/** `GET /sso/clients` (exige `sso.clients.manage` y reautenticación): nunca incluye secretos. */
export async function fetchOidcClients(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<OidcClient[]> {
  const response = await client.get(CLIENTS_PATH, clientsResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/**
 * `POST /sso/clients`: el secreto vuelve UNA sola vez (respuesta `no-store`). Estas funciones
 * se llaman con `useAsyncAction`, nunca con `useMutation` ni como consulta: así el secreto no
 * pasa por la caché de TanStack Query (docs/frontend.md §9). La ruta no es idempotente en el
 * servidor, aunque el cliente HTTP envíe `Idempotency-Key` en todo POST (el servidor la ignora).
 */
export async function registerOidcClient(
  body: RegisterOidcClientRequest,
  client: ApiClient = apiClient,
): Promise<OidcClientWithSecret> {
  const response = await client.post(CLIENTS_PATH, clientWithSecretResponseSchema, { body });
  return response.data;
}

/** `POST /sso/clients/:id/rotate-secret`: el secreto anterior deja de valer y el nuevo vuelve una vez. */
export async function rotateOidcClientSecret(
  id: string,
  client: ApiClient = apiClient,
): Promise<OidcClientWithSecret> {
  const response = await client.post(
    `${CLIENTS_PATH}/${id}/rotate-secret`,
    clientWithSecretResponseSchema,
  );
  return response.data;
}

/** `POST /sso/clients/:id/disable`: no se puede reactivar. */
export async function disableOidcClient(
  id: string,
  client: ApiClient = apiClient,
): Promise<OidcClient> {
  const response = await client.post(`${CLIENTS_PATH}/${id}/disable`, clientResponseSchema);
  return response.data;
}
