import {
  createInvitationResponseSchema,
  directoryUserSchema,
  pendingInvitationSchema,
  roleSchema,
  type CreateInvitationRequest,
} from '@iam/contracts';
import { z } from 'zod';

import { apiClient, createListFetcher, type ApiClient } from '../../../shared/api';

/** Fábrica de claves del directorio (docs/frontend.md §7.3). `useTableQuery` añade la vista. */
export const directoryKeys = {
  all: ['directory'] as const,
  users: () => [...directoryKeys.all, 'users'] as const,
  managed: () => [...directoryKeys.all, 'managed'] as const,
  invitations: () => [...directoryKeys.all, 'invitations'] as const,
  invitableRoles: () => [...directoryKeys.all, 'invitable-roles'] as const,
  managerCandidates: (q: string) => [...directoryKeys.all, 'manager-candidates', q] as const,
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

const pendingResponseSchema = z.object({ data: z.array(pendingInvitationSchema) });
const rolesResponseSchema = z.object({ data: z.array(roleSchema) });
const resendResponseSchema = pendingInvitationSchema.pick({
  id: true,
  email: true,
  rank: true,
  expiresAt: true,
});

/** `GET /invitations`: las invitaciones pendientes propias (la Raíz ve las de todos). */
export async function fetchPendingInvitations(signal: AbortSignal, client: ApiClient = apiClient) {
  const response = await client.get('/invitations', pendingResponseSchema, { signal });
  return response.data;
}

/**
 * `POST /invitations/:id/resend` (201): invalida el enlace anterior y envía uno nuevo. El cliente
 * HTTP añade la clave de idempotencia y la conserva si reintenta tras reautenticar.
 */
export function resendInvitation(id: string, client: ApiClient = apiClient) {
  return client.post(`/invitations/${id}/resend`, resendResponseSchema);
}

/**
 * `GET /roles` filtrado a los roles personalizados: los de sistema no se eligen al invitar (el
 * rango ya les da forma). El servidor valida de todos modos lo que se envíe.
 */
export async function fetchInvitableRoles(signal: AbortSignal, client: ApiClient = apiClient) {
  const response = await client.get('/roles', rolesResponseSchema, { signal });
  return response.data.filter((role) => !role.isSystem);
}
