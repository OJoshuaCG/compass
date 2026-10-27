import type { MeResponse } from '@iam/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';

import { sessionQueryOptions } from '../shared/auth';

/**
 * Guardas de ruta según el estado de la sesión (`/me`). El estado se resuelve con Query (por
 * lo que se comparte con `useMe`) y la ruta de retorno viaja como parámetro de búsqueda.
 *
 * `redirect()` de TanStack Router se lanza con `throw` y no es un `Error`: es su mecanismo.
 */
function go(to: '/login' | '/login/mfa' | '/enroll' | '/', returnTo?: string): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw redirect(to === '/' ? { to } : { to, search: returnTo === undefined ? {} : { returnTo } });
}

/** Rutas privadas: exige sesión completa; si está a medias, lleva al paso que falta. */
export async function requireSession(queryClient: QueryClient, href: string): Promise<MeResponse> {
  const state = await queryClient.query(sessionQueryOptions());
  switch (state.kind) {
    case 'authenticated':
      return state.me;
    case 'anonymous':
      return go('/login', href);
    case 'mfa_required':
      return go('/login/mfa', href);
    case 'enrollment_required':
      return go('/enroll', href);
  }
}

/** Pasos previos a la sesión completa: `/login` admite anónimo o sesión a medias (cambiar de cuenta). */
export async function requirePendingState(
  queryClient: QueryClient,
  step: 'login' | 'mfa' | 'enroll',
  returnTo: string | undefined,
): Promise<void> {
  const state = await queryClient.query(sessionQueryOptions());
  if (state.kind === 'authenticated') return go('/');
  if (step === 'login') return;
  if (state.kind === 'anonymous') return go('/login', returnTo);
  if (step === 'mfa' && state.kind === 'enrollment_required') return go('/enroll', returnTo);
  if (step === 'enroll' && state.kind === 'mfa_required') return go('/login/mfa', returnTo);
}
