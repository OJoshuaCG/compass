/** Firma un `logout_token` (JWT) con la clave activa del emisor. Se llama en cada intento: honra las rotaciones. */
export interface LogoutTokenSigner {
  sign(claims: Readonly<Record<string, unknown>>): Promise<string>;
}
