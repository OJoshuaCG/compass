import { Outlet } from '@tanstack/react-router';

import { ReauthHost } from '../shared/auth';
import { ToastProvider } from '../shared/toast';

/**
 * Raíz del árbol: avisos globales (Toast) y el diálogo de reautenticación, que cualquier
 * petición puede abrir al recibir `AUTHZ.REAUTH_REQUIRED`.
 */
export function RootLayout() {
  return (
    <ToastProvider>
      <Outlet />
      <ReauthHost />
    </ToastProvider>
  );
}
