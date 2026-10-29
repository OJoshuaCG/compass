import {
  createInvitationResponseSchema,
  directoryUserSchema,
  MAX_PAGE_LIMIT,
  pendingInvitationSchema,
  roleSchema,
  type CreateInvitationRequest,
  type Role,
} from '@iam/contracts';

import { apiClient, createListFetcher, type ApiClient } from '../../../shared/api';

/** Fábrica de claves del directorio (docs/frontend.md §7.3). `useTableQuery` añade la vista. */
export const directoryKeys = {
  all: ['directory'] as const,
  users: () => [...directoryKeys.all, 'users'] as const,
  managed: () => [...directoryKeys.all, 'managed'] as const,
  invitations: () => [...directoryKeys.all, 'invitations'] as const,
  invitableRoles: () => [...directoryKeys.all, 'invitable-roles'] as const,
  invitableManagers: () => [...directoryKeys.all, 'invitable-managers'] as const,
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

/** Tope de páginas al reunir todos los roles: evita un ciclo si el servidor repitiera el cursor. */
const MAX_ROLE_PAGES = 50;

const fetchRolesPage = createListFetcher(apiClient, '/roles', roleSchema);
const resendResponseSchema = pendingInvitationSchema.pick({
  id: true,
  email: true,
  rank: true,
  expiresAt: true,
});

/** `GET /invitations?cursor=&limit=`: las pendientes propias (la Raíz ve las de todos), de la más reciente. */
export const fetchPendingInvitationsPage = createListFetcher(
  apiClient,
  '/invitations',
  pendingInvitationSchema,
);

/**
 * `POST /invitations/:id/resend` (201): invalida el enlace anterior y envía uno nuevo. El cliente
 * HTTP añade la clave de idempotencia y la conserva si reintenta tras reautenticar.
 */
export function resendInvitation(id: string, client: ApiClient = apiClient) {
  return client.post(`/invitations/${id}/resend`, resendResponseSchema);
}

/**
 * `GET /roles` recorrido página por página y filtrado a los roles personalizados: los de sistema no
 * se eligen al invitar (el rango ya les da forma) y el selector necesita la lista completa. El
 * servidor valida de todos modos lo que se envíe.
 */
export async function fetchInvitableRoles(signal: AbortSignal) {
  const custom: Role[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_ROLE_PAGES; pageNumber += 1) {
    const page = await fetchRolesPage({ limit: MAX_PAGE_LIMIT, cursor }, signal);
    custom.push(...page.data.filter((role) => !role.isSystem));
    if (page.page.nextCursor === null) break;
    cursor = page.page.nextCursor;
  }
  return custom;
}
