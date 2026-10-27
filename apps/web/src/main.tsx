// Fuentes autoalojadas (misma tipografía de Google, sin terceros: CSP `font-src 'self'`).
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import './shared/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { createQueryClient } from './app/query-client';
import { createAppRouter } from './app/router';
import { createI18n, detectInitialLocale } from './shared/i18n';

const container = document.getElementById('root');
if (container === null) throw new Error('Root container #root not found');

const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <App
      router={createAppRouter(queryClient)}
      i18n={createI18n(detectInitialLocale())}
      queryClient={queryClient}
    />
  </StrictMode>,
);
