import { managedUserSchema, type Rank } from '@iam/contracts';

import { apiClient, createListFetcher, noContentSchema, type ApiClient } from '../../../shared/api';

import { fetchUsersPage } from './directory-api';

/** `GET /users/managed?cursor=&limit=&sort=&dir=&q=`: las personas del subárbol de quien consulta. */
export const fetchManagedPage = createListFetcher(apiClient, '/users/managed', managedUserSchema);

/**
 * Candidatos a responsable: el directorio visible, ordenado por rango para que los de más
 * autoridad (los únicos elegibles) lleguen primero dentro de la página.
 */
export function fetchManagerCandidates(q: string, signal: AbortSignal) {
  return fetchUsersPage({ q, limit: 25, sort: 'rank', dir: 'asc' }, signal);
}

/**
 * Acciones sobre una persona gestionada: todas responden 204. El cliente HTTP reintenta una vez
 * tras reautenticar (cambiar el rango la exige) con la misma clave de idempotencia.
 */
export function createTeamApi(client: ApiClient = apiClient) {
  const post = (id: string, action: string, body?: unknown) =>
    client.post(`/users/${id}/${action}`, noContentSchema, body === undefined ? {} : { body });
  return {
    suspend: (id: string) => post(id, 'suspend'),
    reactivate: (id: string) => post(id, 'reactivate'),
    deactivate: (id: string) => post(id, 'deactivate'),
    changeRank: (id: string, rank: Exclude<Rank, 0>) => post(id, 'rank', { rank }),
    transferManager: (id: string, managerId: string) => post(id, 'manager', { managerId }),
  };
}

export const teamApi = createTeamApi();
