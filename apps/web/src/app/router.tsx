import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  type RouterHistory,
} from '@tanstack/react-router';

import { AppLayout } from '../routes/app-layout';
import { catalogSearchSchema } from '../routes/catalog-search';
import { requirePendingState, requireSession } from '../routes/guards';
import { HomePage } from '../routes/home-page';
import { NotFoundPage, RootNotFound } from '../routes/not-found-page';
import { PublicLayout } from '../routes/public-layout';
import { RootLayout } from '../routes/root-layout';
import {
  invitationSearchSchema,
  returnToSearchSchema,
  usersSearchSchema,
} from '../routes/search-schemas';

export type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: RootNotFound,
});

// Dos marcos sin ruta propia: el público (login, MFA, enrolamiento, invitación) y el privado,
// cuya guarda exige sesión completa.
const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: '_public',
  component: PublicLayout,
});

const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  beforeLoad: ({ context, location }) => requireSession(context.queryClient, location.href),
  component: AppLayout,
});

// Pantallas de acceso: cada una en su fragmento (el login no descarga el directorio).
const loginRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/login',
  validateSearch: returnToSearchSchema,
  beforeLoad: ({ context, search }) =>
    requirePendingState(context.queryClient, 'login', search.returnTo),
  component: lazyRouteComponent(() => import('../routes/auth-routes'), 'LoginRoute'),
});

const mfaRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/login/mfa',
  validateSearch: returnToSearchSchema,
  beforeLoad: ({ context, search }) =>
    requirePendingState(context.queryClient, 'mfa', search.returnTo),
  component: lazyRouteComponent(() => import('../routes/auth-routes'), 'MfaRoute'),
});

const enrollRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/enroll',
  validateSearch: returnToSearchSchema,
  beforeLoad: ({ context, search }) =>
    requirePendingState(context.queryClient, 'enroll', search.returnTo),
  component: lazyRouteComponent(() => import('../routes/auth-routes'), 'EnrollRoute'),
});

const invitationRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/invitation',
  validateSearch: invitationSearchSchema,
  component: lazyRouteComponent(() => import('../routes/auth-routes'), 'InvitationRoute'),
});

const homeRoute = createRoute({ getParentRoute: () => appLayout, path: '/', component: HomePage });

const usersRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/users',
  validateSearch: usersSearchSchema,
  component: lazyRouteComponent(() => import('../routes/users-route'), 'UsersRoute'),
});

// El catálogo solo existe en desarrollo: en producción el `import()` queda como código muerto
// (se elimina del bundle) y la ruta responde 404.
const loadCatalog = import.meta.env.DEV
  ? () => import('../routes/catalog-route-page')
  : () => Promise.resolve({ CatalogRoutePage: NotFoundPage });

const catalogRoute = createRoute({
  getParentRoute: () => appLayout,
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
const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([loginRoute, mfaRoute, enrollRoute, invitationRoute]),
  appLayout.addChildren([homeRoute, usersRoute, catalogRoute]),
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
