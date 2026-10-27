import { ErrorCode, meResponseSchema, type MeResponse, type Permission } from '@iam/contracts';
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';

import { ApiError, apiClient, type ApiClient } from '../api';

import { announceSessionEnded } from './session-sync';

/** Fábrica de claves de la sesión: nunca cadenas sueltas (docs/frontend.md §7.3). */
export const sessionKeys = {
  all: ['session'] as const,
  me: () => [...sessionKeys.all, 'me'] as const,
};

/**
 * Los estados en que puede estar la sesión según `/me`. Una sesión a medias (falta cambiar la
 * contraseña inicial, el segundo factor o registrarlo) responde 403, pero para la UI es un estado
 * esperado, no un fallo.
 */
export type SessionState =
  | { kind: 'authenticated'; me: MeResponse }
  | { kind: 'anonymous' }
  | { kind: 'password_change_required' }
  | { kind: 'mfa_required' }
  | { kind: 'enrollment_required' };

export async function loadSessionState(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<SessionState> {
  try {
    // El 401 de `/me` es "no hay sesión" (un estado), no una sesión que expiró en uso.
    const me = await client.get('/me', meResponseSchema, {
      suppressSessionExpiry: true,
      ...(signal !== undefined ? { signal } : {}),
    });
    return { kind: 'authenticated', me };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return { kind: 'anonymous' };
      if (error.status === 403 && error.code === ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED)
        return { kind: 'password_change_required' };
      if (error.status === 403 && error.code === ErrorCode.AUTH_MFA_REQUIRED)
        return { kind: 'mfa_required' };
      if (error.status === 403 && error.code === ErrorCode.AUTH_ENROLLMENT_REQUIRED)
        return { kind: 'enrollment_required' };
    }
    throw error;
  }
}

export function sessionQueryOptions(client: ApiClient = apiClient) {
  return queryOptions({
    queryKey: sessionKeys.me(),
    queryFn: async ({ signal, client: queryClient }) => {
      const previous = queryClient.getQueryData<SessionState>(sessionKeys.me());
      const state = await loadSessionState(client, signal);
      // Había sesión y `/me` responde 401: se perdió (la cerraron en otro lado o expiró). Las demás
      // pestañas lo saben de inmediato en vez de esperar a su próxima petición.
      if (state.kind === 'anonymous' && previous?.kind === 'authenticated') announceSessionEnded();
      return state;
    },
    // Las mutaciones de autenticación invalidan esta clave; el tiempo solo evita repetir
    // `/me` en cada navegación.
    staleTime: 60_000,
    retry: false,
  });
}

/** Estado de la sesión (o `undefined` mientras carga). */
export function useSessionState(): SessionState | undefined {
  return useQuery(sessionQueryOptions()).data;
}

/** Usuario autenticado, o `undefined` si no hay sesión completa o aún carga. */
export function useMe(): MeResponse | undefined {
  const state = useSessionState();
  return state?.kind === 'authenticated' ? state.me : undefined;
}

/**
 * Solo comodidad de UI: oculta lo que el usuario no puede hacer. La autorización real la
 * decide siempre el backend (docs/frontend.md §1.3).
 */
export function usePermission(permission: Permission): boolean {
  return useMe()?.permissions.includes(permission) ?? false;
}

/**
 * Descarta el estado de sesión en caché tras una mutación de autenticación (login, MFA,
 * enrolamiento, aceptar invitación): el siguiente guardado vuelve a preguntar a `/me`.
 */
export function resetSession(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: sessionKeys.all });
}
