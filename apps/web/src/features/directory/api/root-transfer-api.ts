import { MAX_PAGE_LIMIT, rootTransferSchema } from '@iam/contracts';
import type { ProposeRootTransferRequest } from '@iam/contracts';
import { z } from 'zod';

import { apiClient, noContentSchema, type ApiClient } from '../../../shared/api';

import { fetchUsersPage } from './directory-api';

/** Fábrica de claves de la transferencia de la Raíz (docs/frontend.md §7.3). */
export const rootTransferKeys = {
  all: ['root-transfer'] as const,
  current: () => [...rootTransferKeys.all, 'current'] as const,
  leadership: () => [...rootTransferKeys.all, 'leadership'] as const,
};

const ROOT_TRANSFER_PATH = '/root-transfer';

const currentRootTransferSchema = z.object({ data: rootTransferSchema.nullable() });
const rootTransferResponseSchema = z.object({ data: rootTransferSchema });

/**
 * `GET /root-transfer`: la transferencia abierta o `null`. Solo la responde a la Raíz y a los
 * Administradores; cualquier otro rango recibe 403.
 */
export async function fetchCurrentRootTransfer(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get(ROOT_TRANSFER_PATH, currentRootTransferSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/** `POST /root-transfer` (permiso `org.settings`, reautenticación reciente): la Raíz propone el puesto. */
export async function proposeRootTransfer(
  body: ProposeRootTransferRequest,
  client: ApiClient = apiClient,
) {
  const response = await client.post(ROOT_TRANSFER_PATH, rootTransferResponseSchema, { body });
  return response.data;
}

/** `POST /root-transfer/accept`: solo la persona destinataria; el servidor exige reautenticación reciente. */
export async function acceptRootTransfer(client: ApiClient = apiClient) {
  const response = await client.post(`${ROOT_TRANSFER_PATH}/accept`, rootTransferResponseSchema);
  return response.data;
}

/** `DELETE /root-transfer`: la Raíz, la persona destinataria o cualquier Administrador la detienen. Responde 204. */
export function cancelRootTransfer(client: ApiClient = apiClient) {
  return client.delete(ROOT_TRANSFER_PATH, noContentSchema);
}

/**
 * Raíz y Administradores del directorio visible. Se piden ordenados por rango para que lleguen
 * primero dentro de la página; sirve para poner nombre a quien propone y a quien recibe, y para
 * ofrecer a los candidatos. El servidor valida la elegibilidad de todos modos.
 */
export async function fetchLeadership(signal: AbortSignal) {
  const page = await fetchUsersPage({ limit: MAX_PAGE_LIMIT, sort: 'rank', dir: 'asc' }, signal);
  return page.data;
}
