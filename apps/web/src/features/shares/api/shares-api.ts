import {
  accountSchema,
  directoryUserSchema,
  shareSchema,
  type CreateShareRequest,
} from '@iam/contracts';
import { z } from 'zod';

import { apiClient, createListFetcher, noContentSchema, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de las comparticiones (docs/frontend.md §7.3). */
export const sharesKeys = {
  all: ['shares'] as const,
  account: (accountId: string) => [...sharesKeys.all, 'account', accountId] as const,
  list: (accountId: string) => [...sharesKeys.all, 'list', accountId] as const,
  candidates: (query: string) => [...sharesKeys.all, 'candidates', query] as const,
};

const sharesResponseSchema = z.object({ data: z.array(shareSchema) });

/** Cuántas personas candidatas se piden por búsqueda; el selector no pagina, se afina escribiendo. */
const CANDIDATES_LIMIT = 25;

const fetchDirectoryPage = createListFetcher(apiClient, '/users', directoryUserSchema);

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

/** `GET /accounts/:id/shares`: las comparticiones vigentes, completas y sin paginar. */
export async function fetchShares(
  accountId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get(`/accounts/${accountId}/shares`, sharesResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/**
 * `POST /accounts/:id/shares` (exige `share.manage` y nivel MANAGE). El cliente HTTP añade la clave
 * de idempotencia, estable ante reintentos.
 */
export function createShare(
  accountId: string,
  body: CreateShareRequest,
  client: ApiClient = apiClient,
) {
  return client.post(`/accounts/${accountId}/shares`, shareSchema, { body });
}

/** `POST /accounts/:id/shares/:shareId/revoke`: responde 204. */
export function revokeShare(accountId: string, shareId: string, client: ApiClient = apiClient) {
  return client.post(`/accounts/${accountId}/shares/${shareId}/revoke`, noContentSchema);
}

/**
 * Personas a las que se puede compartir, buscadas en el directorio (`GET /users?q=`). Se llama al
 * mismo endpoint que el feature `directory` en lugar de importarlo: entre features solo se cruza
 * por la fachada (docs/frontend.md §3.2) y la fachada de `directory` no expone esta búsqueda.
 */
export function fetchShareCandidates(query: string, signal: AbortSignal) {
  return fetchDirectoryPage(
    { q: query, limit: CANDIDATES_LIMIT, sort: 'displayName', dir: 'asc' },
    signal,
  );
}
