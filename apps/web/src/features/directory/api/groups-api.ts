import {
  groupMemberSchema,
  groupSchema,
  type AddGroupMemberRequest,
  type CreateGroupRequest,
} from '@iam/contracts';
import { z } from 'zod';

import { apiClient, type ApiClient } from '../../../shared/api';

import { fetchUsersPage } from './directory-api';

/** Fábrica de claves de los grupos (docs/frontend.md §7.3). */
export const groupsKeys = {
  all: ['groups'] as const,
  list: () => [...groupsKeys.all, 'list'] as const,
  members: (groupId: string) => [...groupsKeys.all, 'members', groupId] as const,
  candidates: (query: string) => [...groupsKeys.all, 'candidates', query] as const,
};

const GROUPS_PATH = '/groups';

/** Cuántas personas candidatas se piden por búsqueda; el selector no pagina, se afina escribiendo. */
const CANDIDATES_LIMIT = 25;

const groupsResponseSchema = z.object({ data: z.array(groupSchema) });
const createdGroupResponseSchema = z.object({ data: z.object({ id: z.uuid() }) });
const membersResponseSchema = z.object({ data: z.array(groupMemberSchema) });

/** `GET /groups`: los grupos que quien consulta puede ver, ya acotados por el servidor. */
export async function fetchGroups(signal?: AbortSignal, client: ApiClient = apiClient) {
  const response = await client.get(GROUPS_PATH, groupsResponseSchema, {
    query: { managedByMe: 'false' },
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/** `POST /groups` (permiso `group.create`): quien lo crea queda como su primer gestor. */
export async function createGroup(body: CreateGroupRequest, client: ApiClient = apiClient) {
  const response = await client.post(GROUPS_PATH, createdGroupResponseSchema, { body });
  return response.data;
}

/** `GET /groups/:groupId/members`. */
export async function fetchGroupMembers(
  groupId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get(`${GROUPS_PATH}/${groupId}/members`, membersResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/** `POST /groups/:groupId/members`: responde la lista de miembros ya actualizada. */
export async function addGroupMember(
  groupId: string,
  body: AddGroupMemberRequest,
  client: ApiClient = apiClient,
) {
  const response = await client.post(`${GROUPS_PATH}/${groupId}/members`, membersResponseSchema, {
    body,
  });
  return response.data;
}

/** `DELETE /groups/:groupId/members/:userId`: responde 200 con la lista de miembros actualizada. */
export async function removeGroupMember(
  groupId: string,
  userId: string,
  client: ApiClient = apiClient,
) {
  const response = await client.delete(
    `${GROUPS_PATH}/${groupId}/members/${userId}`,
    membersResponseSchema,
  );
  return response.data;
}

/** Personas candidatas a miembro, buscadas en el directorio (`GET /users?q=`). */
export function fetchMemberCandidates(query: string, signal: AbortSignal) {
  return fetchUsersPage(
    { q: query, limit: CANDIDATES_LIMIT, sort: 'displayName', dir: 'asc' },
    signal,
  );
}
