import { Outlet } from '@tanstack/react-router';

import { ReauthHost } from '../shared/auth';
import { ToastProvider } from '../shared/toast';
import { useRouteAnnouncer } from './use-route-announcer';

/**
 * Raíz del árbol: avisos globales (Toast) y el diálogo de reautenticación, que cualquier
 * petición puede abrir al recibir `AUTHZ.REAUTH_REQUIRED`. También anuncia los cambios de ruta
 * (título del documento y foco).
 */
export function RootLayout() {
  useRouteAnnouncer();
  return (
    <ToastProvider>
      <Outlet />
      <ReauthHost />
    </ToastProvider>
  );
}
