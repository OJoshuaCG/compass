/**
 * Las rutas `/oidc/...` las sirve el proveedor, no la SPA: el router no puede navegar a ellas y
 * hace falta una navegación de página completa. Vive aparte para que las pruebas la sustituyan.
 */
export function navigateToProvider(path: string): void {
  globalThis.location.assign(path);
}

export const interactionContinuePath = (uid: string) =>
  `/oidc/interaction/${encodeURIComponent(uid)}`;
export const authorizationResumePath = (uid: string) => `/oidc/auth/${encodeURIComponent(uid)}`;
