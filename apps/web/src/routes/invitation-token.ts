/**
 * Extrae el token de invitación de la URL: del fragmento (`#token=…`, preferido porque el
 * navegador no lo envía en peticiones ni en `Referer`) o de la query (`?token=…`).
 */
export function readInvitationToken(
  queryToken: string | undefined,
  hash: string,
): { token: string | undefined; fromUrl: boolean } {
  const fragment = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  const token = fragment ?? queryToken;
  const present = token !== undefined && token !== '';
  return { token: present ? token : undefined, fromUrl: present };
}
