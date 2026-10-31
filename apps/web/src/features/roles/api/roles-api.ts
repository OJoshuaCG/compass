import { roleSchema, type CreateRoleRequest, type UpdateRoleRequest } from '@iam/contracts';

import { apiClient, createListFetcher, noContentSchema, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de los roles (docs/frontend.md §7.3). */
export const rolesKeys = {
  all: ['roles'] as const,
  list: () => [...rolesKeys.all, 'list'] as const,
};

/** `GET /roles?cursor=&limit=`: plantillas del sistema primero y luego las personalizadas por nombre. */
export const fetchRolesPage = createListFetcher(apiClient, '/roles', roleSchema);

/** `POST /roles` (201, exige `role.manage`): 409 nombre repetido, 403 escalamiento. */
export function createRole(body: CreateRoleRequest, client: ApiClient = apiClient) {
  return client.post('/roles', roleSchema, { body });
}

/**
 * `PATCH /roles/:id` (200, exige `role.manage`): reemplaza nombre y permisos. 409 nombre repetido,
 * 403 escalamiento (el editor debe tener los permisos actuales y los nuevos) o rol de sistema.
 * El servidor marca esta ruta como idempotente y rechaza la petición sin `Idempotency-Key`.
 */
export function updateRole(id: string, body: UpdateRoleRequest, client: ApiClient = apiClient) {
  return client.patch(`/roles/${id}`, roleSchema, { body, idempotencyKey: crypto.randomUUID() });
}

/** `POST /roles/:id/archive` (204, exige `role.manage`): los roles de sistema responden 403. */
export function archiveRole(id: string, client: ApiClient = apiClient) {
  return client.post(`/roles/${id}/archive`, noContentSchema);
}
