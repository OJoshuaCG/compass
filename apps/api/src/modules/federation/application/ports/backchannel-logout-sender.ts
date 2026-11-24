export interface BackchannelLogoutRequest {
  /** `backchannel_logout_uri` registrada del cliente. */
  readonly url: string;
  readonly logoutToken: string;
  /** Cliente marcado `allowPrivateNetworkBackchannel`: usa el guardia con las redes del despliegue. */
  readonly allowPrivateNetwork: boolean;
}

/**
 * Resultado sin detalles: ni la dirección ni la respuesta del cliente salen del adaptador.
 * `retryable` distingue fallas transitorias (red, 5xx, 429) de rechazos permanentes.
 */
export type BackchannelLogoutOutcome =
  { readonly ok: true } | { readonly ok: false; readonly retryable: boolean };

export interface BackchannelLogoutSender {
  send(request: BackchannelLogoutRequest): Promise<BackchannelLogoutOutcome>;
}
