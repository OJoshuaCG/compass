import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { i18n as I18nInstance } from 'i18next';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';

import { bindSessionExpiry } from './session-expiry';
import type { createAppRouter } from './router';

export type AppProps = {
  router: ReturnType<typeof createAppRouter>;
  i18n: I18nInstance;
  queryClient: QueryClient;
};

/** Providers de la app: Query, i18next y router. Se reciben por props para poder probarlos. */
export function App({ router, i18n, queryClient }: AppProps) {
  // Suscripción a un evento externo (401 del cliente HTTP): un efecto es el lugar correcto.
  useEffect(() => bindSessionExpiry(router, queryClient), [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  );
}
