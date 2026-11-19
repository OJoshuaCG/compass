/** Permisos (scopes) OIDC que la pantalla sabe describir; el resto se muestra tal cual. */
export const KNOWN_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;
export type KnownScope = (typeof KNOWN_SCOPES)[number];

export function isKnownScope(scope: string): scope is KnownScope {
  return (KNOWN_SCOPES as readonly string[]).includes(scope);
}
