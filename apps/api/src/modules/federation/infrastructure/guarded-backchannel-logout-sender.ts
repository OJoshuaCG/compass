/**
 * Envío del `logout_token` a la `backchannel_logout_uri` de una aplicación (OIDC Back-Channel Logout 1.0).
 *
 * Invariantes de seguridad
 * - La dirección la escribe una persona de la organización: TODO envío pasa por un cliente con guardia
 *   SSRF (solo https, sin redirecciones, host validado en cada envío). La biblioteca del proveedor no envía.
 * - Un cliente marcado `allowPrivateNetwork` usa un segundo cliente cuyo guardia solo admite las redes del
 *   despliegue (`OIDC_BACKCHANNEL_PRIVATE_NETWORKS`); bucle local y link-local nunca se permiten.
 * - Ni la dirección, ni el token, ni la respuesta del cliente salen de aquí: solo `ok` / `retryable`.
 */
import type {
  BackchannelLogoutOutcome,
  BackchannelLogoutRequest,
  BackchannelLogoutSender,
} from '../application/ports/backchannel-logout-sender.js';

/** Forma mínima del cliente HTTPS saliente; la cumple `GuardedHttpsClient` sin importar otro módulo. */
export interface BackchannelHttpClient {
  send(request: {
    readonly url: string;
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }): Promise<
    { readonly ok: true; readonly status: number } | { readonly ok: false; readonly code: string }
  >;
}

/** Fallas de red que pueden desaparecer solas; el resto (destino no permitido, esquema, puerto...) no. */
const RETRYABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'HOST_UNRESOLVED',
  'TIMEOUT',
  'NETWORK_ERROR',
]);

const REQUEST_TIMEOUT_STATUS = 408;
const TOO_MANY_REQUESTS_STATUS = 429;
const SERVER_ERROR_FROM_STATUS = 500;

export class GuardedBackchannelLogoutSender implements BackchannelLogoutSender {
  constructor(
    private readonly publicClient: BackchannelHttpClient,
    private readonly privateNetworkClient: BackchannelHttpClient,
  ) {}

  async send(request: BackchannelLogoutRequest): Promise<BackchannelLogoutOutcome> {
    const client = request.allowPrivateNetwork ? this.privateNetworkClient : this.publicClient;
    const result = await client.send({
      url: request.url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-store' },
      body: new URLSearchParams({ logout_token: request.logoutToken }).toString(),
    });
    if (!result.ok) return { ok: false, retryable: RETRYABLE_FAILURE_CODES.has(result.code) };
    if (result.status >= 200 && result.status < 300) return { ok: true };
    const retryable =
      result.status === REQUEST_TIMEOUT_STATUS ||
      result.status === TOO_MANY_REQUESTS_STATUS ||
      result.status >= SERVER_ERROR_FROM_STATUS;
    return { ok: false, retryable };
  }
}
