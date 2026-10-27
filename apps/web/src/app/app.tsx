import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { i18n as I18nInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import type { createAppRouter } from './router';

export type AppProps = {
  router: ReturnType<typeof createAppRouter>;
  i18n: I18nInstance;
  queryClient: QueryClient;
};

/** Providers de la app: Query, i18next y router. Se reciben por props para poder probarlos. */
export function App({ router, i18n, queryClient }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  );
}
