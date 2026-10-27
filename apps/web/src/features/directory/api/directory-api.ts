import {
  createInvitationResponseSchema,
  directoryUserSchema,
  type CreateInvitationRequest,
} from '@iam/contracts';

import { apiClient, createListFetcher, type ApiClient } from '../../../shared/api';

/** Fábrica de claves del directorio (docs/frontend.md §7.3). `useTableQuery` añade la vista. */
export const directoryKeys = {
  all: ['directory'] as const,
  users: () => [...directoryKeys.all, 'users'] as const,
};

/** `GET /users?cursor=&limit=&sort=&dir=&q=` validado con el contrato. */
export const fetchUsersPage = createListFetcher(apiClient, '/users', directoryUserSchema);

/**
 * `POST /invitations`. Recibe la clave de idempotencia del llamador para que un reintento
 * (tras reautenticar o por un fallo de red) sea la misma operación y no cree dos invitaciones.
 */
export function inviteUser(
  body: CreateInvitationRequest,
  idempotencyKey: string,
  client: ApiClient = apiClient,
) {
  return client.post('/invitations', createInvitationResponseSchema, { body, idempotencyKey });
}
