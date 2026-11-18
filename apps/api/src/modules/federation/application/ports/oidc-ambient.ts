/**
 * Contexto de la petición que lleva la sesión de Compass (cookie válida): lo fijan las rutas de login e
 * interacción (T8), nunca el cliente OIDC. Las llamadas del cliente (por ejemplo el punto de token) no lo
 * tienen y la organización sale entonces de la propia clave que consultan.
 */
export interface OidcAmbientContext {
  readonly organizationId: string;
  readonly compassSessionId: string;
  readonly userId: string;
}

export interface OidcAmbientReader {
  current(): OidcAmbientContext | null;
}
