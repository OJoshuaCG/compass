/** Prefijo de las rutas que sirve el proveedor OIDC (no son rutas de la SPA). */
export const PROVIDER_PATH_PREFIX = '/oidc/';

type NavigationRouter = {
  navigate: (options: { to: '/' }) => unknown;
  history: { push: (path: string) => void };
};

/** Vuelve a donde iba el usuario (si la ruta es interna) o al inicio. */
export function navigateAfterAuth(router: NavigationRouter, returnTo: string | undefined): void {
  if (returnTo === undefined) {
    void router.navigate({ to: '/' });
    return;
  }
  // Defensa en profundidad: si el navegador rechaza la ruta (SecurityError) el usuario, que
  // ya está autenticado, no se queda atascado en la pantalla de MFA o enrolamiento.
  try {
    // `/oidc/...` lo sirve el proveedor, no la SPA: `history.push` solo cambiaría la URL sin
    // pedir la página al servidor, así que hace falta una navegación de página completa.
    if (returnTo.startsWith(PROVIDER_PATH_PREFIX)) {
      globalThis.location.assign(returnTo);
      return;
    }
    router.history.push(returnTo);
  } catch {
    void router.navigate({ to: '/' });
  }
}
