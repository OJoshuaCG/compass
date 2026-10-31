import {
  createInvitationResponseSchema,
  createInvitationWithLinkResponseSchema,
  directoryUserSchema,
  MAX_PAGE_LIMIT,
  pendingInvitationSchema,
  personRolesSchema,
  roleSchema,
  type CreateInvitationRequest,
  type Permission,
  type Role,
} from '@iam/contracts';

import {
  apiClient,
  createApiClient,
  createListFetcher,
  emitSessionExpired,
  reauthCoordinator,
  type ApiClient,
} from '../../../shared/api';

/** Fábrica de claves del directorio (docs/frontend.md §7.3). `useTableQuery` añade la vista. */
export const directoryKeys = {
  all: ['directory'] as const,
  users: () => [...directoryKeys.all, 'users'] as const,
  managed: () => [...directoryKeys.all, 'managed'] as const,
  invitations: () => [...directoryKeys.all, 'invitations'] as const,
  invitableRoles: () => [...directoryKeys.all, 'invitable-roles'] as const,
  assignableRoles: () => [...directoryKeys.all, 'assignable-roles'] as const,
  personRoles: (id: string) => [...directoryKeys.all, 'person-roles', id] as const,
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

/**
 * Cliente para las rutas que entregan el enlace de invitación. El cliente base añade
 * `Idempotency-Key` a todo POST, pero estas rutas NO son idempotentes a propósito: el servidor no
 * debe guardar el enlace en la tabla de idempotencia. Por eso se quita la cabecera justo antes de
 * enviar. Conserva la reautenticación (un solo reintento) y el aviso de sesión expirada.
 */
const linkClient: ApiClient = createApiClient({
  fetchImpl: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('Idempotency-Key');
    return fetch(input, { ...init, headers });
  },
  onReauthRequired: () => reauthCoordinator.request(),
  onSessionExpired: emitSessionExpired,
});

/**
 * `POST /invitations/with-link` (permiso `user.invite_link`): mismo cuerpo que `POST /invitations`,
 * pero la respuesta trae el enlace. Sin clave de idempotencia; el llamador no debe guardar el
 * resultado fuera de su estado local (nunca en la caché de Query).
 */
export function inviteUserWithLink(body: CreateInvitationRequest, client: ApiClient = linkClient) {
  return client.post('/invitations/with-link', createInvitationWithLinkResponseSchema, { body });
}

/** `POST /invitations/:id/resend-with-link`: reenvía (revoca el enlace anterior) y entrega el nuevo. */
export function resendInvitationWithLink(id: string, client: ApiClient = linkClient) {
  return client.post(`/invitations/${id}/resend-with-link`, createInvitationWithLinkResponseSchema);
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
  const allRoles = await fetchAssignableRoles(signal);
  return allRoles.filter((role) => !role.isSystem);
}

/**
 * `GET /roles` recorrido página por página, con los roles de sistema incluidos: asignar roles a una
 * persona sí puede usar las plantillas. Aparte de `fetchInvitableRoles`, que las excluye a propósito
 * al invitar. Los roles personales (permisos especiales) nunca llegan en esta lista.
 */
export async function fetchAssignableRoles(signal: AbortSignal) {
  const roles: Role[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_ROLE_PAGES; pageNumber += 1) {
    const page = await fetchRolesPage({ limit: MAX_PAGE_LIMIT, cursor }, signal);
    roles.push(...page.data);
    if (page.page.nextCursor === null) break;
    cursor = page.page.nextCursor;
  }
  return roles;
}

/** `GET /users/:id/roles` (exige `user.invite` sobre la persona): sus roles y permisos especiales. */
export function fetchPersonRoles(id: string, signal: AbortSignal, client: ApiClient = apiClient) {
  return client.get(`/users/${id}/roles`, personRolesSchema, { signal });
}

/**
 * `POST /users/:id/roles` (exige `role.assign` y reautenticación reciente): reemplaza los roles
 * elegibles de la persona. El cliente HTTP reautentica y reintenta una vez con la misma clave.
 */
export function setPersonRoles(id: string, roleIds: string[], client: ApiClient = apiClient) {
  return client.post(`/users/${id}/roles`, personRolesSchema, { body: { roleIds } });
}

/** `POST /users/:id/special-permissions`: reemplaza los permisos especiales; vacío los retira todos. */
export function setSpecialPermissions(
  id: string,
  permissions: Permission[],
  client: ApiClient = apiClient,
) {
  return client.post(`/users/${id}/special-permissions`, personRolesSchema, {
    body: { permissions },
  });
}
