import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';

import { App } from '../app/app';
import { createQueryClient } from '../app/query-client';
import { createAppRouter } from '../app/router';
import { createI18n } from '../shared/i18n';

/** Monta la app completa (providers + router en memoria) en una ruta; sin servidor real. */
export function renderApp(path: string, locale: 'es-MX' | 'en-US' = 'es-MX') {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  return {
    router,
    queryClient,
    ...render(<App router={router} i18n={createI18n(locale)} queryClient={queryClient} />),
  };
}
