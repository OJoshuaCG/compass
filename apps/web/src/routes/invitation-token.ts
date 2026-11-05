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

/**
 * Lee el token del enlace de configuración inicial (`/setup#token=…`) sin tratar `+` como espacio.
 * `URLSearchParams` decodifica el fragmento como formulario y convertiría el `+` de un token en
 * base64 (`openssl rand -base64`) en un espacio: el token enviado no coincidiría con el configurado.
 * Solo se revierte el porcentaje (`%2B`, `%2F`...) y el resto se toma tal cual.
 */
export function readSetupToken(hash: string): { token: string | undefined; fromUrl: boolean } {
  const match = /(?:^#?|&)token=([^&]*)/.exec(hash);
  const raw = match?.[1] ?? '';
  let token = raw;
  try {
    token = decodeURIComponent(raw);
  } catch {
    // Un `%` suelto no es una secuencia válida: se usa el valor literal.
  }
  const present = token !== '';
  return { token: present ? token : undefined, fromUrl: present };
}
