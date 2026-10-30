import {
  managedUserSchema,
  MAX_PAGE_LIMIT,
  rankChangeResponseSchema,
  type ManagedUser,
  type Rank,
} from '@iam/contracts';

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

/** Tope de páginas al reunir el subárbol: evita un ciclo si el servidor repitiera el cursor. */
const MAX_MANAGER_PAGES = 10;

/**
 * Posibles responsables de una persona invitada: el subárbol de quien invita (`/users/managed`), que
 * es exactamente el alcance que el servidor exige y no pide permisos de gestión. Se ordena por
 * rango para que, si el subárbol excediera el tope, se pierdan los de menos autoridad (los que
 * menos probablemente sean elegibles). El servidor valida de todos modos.
 */
export async function fetchInvitableManagers(signal: AbortSignal) {
  const people: ManagedUser[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_MANAGER_PAGES; pageNumber += 1) {
    const page = await fetchManagedPage(
      { limit: MAX_PAGE_LIMIT, sort: 'rank', dir: 'asc', cursor },
      signal,
    );
    people.push(...page.data);
    if (page.page.nextCursor === null) break;
    cursor = page.page.nextCursor;
  }
  return people;
}

/**
 * Acciones sobre una persona gestionada: todas responden 204, salvo cambiar el rango (200 con cuerpo). El cliente HTTP reintenta una vez
 * tras reautenticar (cambiar el rango la exige) con la misma clave de idempotencia.
 */
export function createTeamApi(client: ApiClient = apiClient) {
  const post = (id: string, action: string, body?: unknown) =>
    client.post(`/users/${id}/${action}`, noContentSchema, body === undefined ? {} : { body });
  return {
    suspend: (id: string) => post(id, 'suspend'),
    reactivate: (id: string) => post(id, 'reactivate'),
    deactivate: (id: string) => post(id, 'deactivate'),
    /** Cierra TODAS las sesiones de la persona (204); exige `user.deactivate`, sin reautenticación. */
    closeSessions: (id: string) => post(id, 'sessions/revoke'),
    // Responde 200 con el resultado del cambio: roles retirados, plantilla asignada y comparticiones a revisar.
    changeRank: (id: string, rank: Exclude<Rank, 0>, reason?: string) =>
      client.post(`/users/${id}/rank`, rankChangeResponseSchema, {
        body: reason === undefined ? { rank } : { rank, reason },
      }),
    transferManager: (id: string, managerId: string) => post(id, 'manager', { managerId }),
  };
}

export const teamApi = createTeamApi();
