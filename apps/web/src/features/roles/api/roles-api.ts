import { roleSchema, type CreateRoleRequest } from '@iam/contracts';
import { z } from 'zod';

import { apiClient, noContentSchema, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de los roles (docs/frontend.md §7.3). */
export const rolesKeys = {
  all: ['roles'] as const,
  list: () => [...rolesKeys.all, 'list'] as const,
};

const rolesResponseSchema = z.object({ data: z.array(roleSchema) });

/** `GET /roles`: roles de sistema y personalizados (exige `user.invite`). */
export async function fetchRoles(signal: AbortSignal, client: ApiClient = apiClient) {
  const response = await client.get('/roles', rolesResponseSchema, { signal });
  return response.data;
}

/** `POST /roles` (201, exige `role.manage`): 409 nombre repetido, 403 escalamiento. */
export function createRole(body: CreateRoleRequest, client: ApiClient = apiClient) {
  return client.post('/roles', roleSchema, { body });
}

/** `POST /roles/:id/archive` (204, exige `role.manage`): los roles de sistema responden 403. */
export function archiveRole(id: string, client: ApiClient = apiClient) {
  return client.post(`/roles/${id}/archive`, noContentSchema);
}
