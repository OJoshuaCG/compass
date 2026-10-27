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
    router.history.push(returnTo);
  } catch {
    void router.navigate({ to: '/' });
  }
}
