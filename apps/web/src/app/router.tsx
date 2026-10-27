import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  type RouterHistory,
} from '@tanstack/react-router';

import { catalogSearchSchema } from '../routes/catalog-search';
import { HomePage } from '../routes/home-page';
import { NotFoundPage } from '../routes/not-found-page';
import { RootLayout } from '../routes/root-layout';

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundPage });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });

// El catálogo solo existe en desarrollo: en producción el `import()` queda como código muerto
// (se elimina del bundle) y la ruta responde 404.
const loadCatalog = import.meta.env.DEV
  ? () => import('../routes/catalog-route-page')
  : () => Promise.resolve({ CatalogRoutePage: NotFoundPage });

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  validateSearch: catalogSearchSchema,
  beforeLoad: () => {
    // `notFound()` es el mecanismo del router: lanza un objeto propio, no un Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!import.meta.env.DEV) throw notFound();
  },
  component: lazyRouteComponent(loadCatalog, 'CatalogRoutePage'),
});

// Rutas en código (sin file-based routing): el árbol es explícito y revisable.
const routeTree = rootRoute.addChildren([homeRoute, catalogRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, defaultPreload: 'intent', ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
