/**
 * Manejador del outbox que avisa a una aplicación de que la sesión del proveedor terminó (OIDC Back-Channel
 * Logout 1.0, ADR 0052). Corre en el trabajador del outbox, con la organización del evento fijada por RLS.
 *
 * Invariantes de seguridad
 * - El evento solo trae `clientId` y `sid`; el `logout_token` se firma aquí, en cada intento, con la clave
 *   activa del momento. Nunca se guarda ni se registra.
 * - Un cliente deshabilitado, inexistente o sin `backchannel_logout_uri` no es un error: no hay a quién avisar.
 * - Un destino rechazado por el guardia o un rechazo permanente del cliente lanzan un error NO reintentable
 *   (cuarentena); red, 5xx y 429 se reintentan con la espera del outbox.
 * - El acuse por (evento, aplicación+sesión) evita avisar dos veces si el outbox reentrega.
 */
import type { Clock, IdGenerator } from '../../../shared/kernel/index.js';
import {
  BACKCHANNEL_LOGOUT_EVENT_URI,
  BackchannelLogoutError,
  LOGOUT_TOKEN_LIFETIME_SECONDS,
  backchannelLogoutReceiptKey,
  parseBackchannelLogoutPayload,
} from '../domain/backchannel-logout.js';
import type { BackchannelLogoutSender } from './ports/backchannel-logout-sender.js';
import type { LogoutTokenSigner } from './ports/logout-token-signer.js';
import type { OidcClientLookup } from './ports/oidc-client-store.js';

export interface BackchannelLogoutDeliveries {
  wasDelivered(eventId: string, handlerKey: string): Promise<boolean>;
  markDelivered(eventId: string, handlerKey: string): Promise<void>;
}

export interface SendBackchannelLogoutDeps {
  /** `APP_ORIGIN`: el emisor (`iss`) del logout_token debe ser el mismo que el de los id token. */
  readonly issuer: string;
  readonly clients: OidcClientLookup;
  readonly signer: LogoutTokenSigner;
  readonly sender: BackchannelLogoutSender;
  readonly deliveries: BackchannelLogoutDeliveries;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface BackchannelLogoutEvent {
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

export class SendBackchannelLogout {
  constructor(private readonly deps: SendBackchannelLogoutDeps) {}

  async handle(event: BackchannelLogoutEvent): Promise<void> {
    const target = parseBackchannelLogoutPayload(event.payload);
    const receiptKey = backchannelLogoutReceiptKey(target);
    if (await this.deps.deliveries.wasDelivered(event.eventId, receiptKey)) return;

    const client = await this.deps.clients.findActiveByClientId(target.clientId);
    if (client === null || client.backchannelLogoutUri === null) return;

    const issuedAt = Math.floor(this.deps.clock.now().getTime() / 1000);
    // Sin `nonce` (lo exige la especificación) y con `sid`: el cliente cierra solo esa sesión.
    const logoutToken = await this.deps.signer.sign({
      iss: this.deps.issuer,
      aud: target.clientId,
      iat: issuedAt,
      exp: issuedAt + LOGOUT_TOKEN_LIFETIME_SECONDS,
      jti: this.deps.ids.next(),
      sid: target.sid,
      events: { [BACKCHANNEL_LOGOUT_EVENT_URI]: {} },
    });

    const outcome = await this.deps.sender.send({
      url: client.backchannelLogoutUri,
      logoutToken,
      allowPrivateNetwork: client.allowPrivateNetworkBackchannel,
    });
    if (!outcome.ok) {
      throw new BackchannelLogoutError(
        outcome.retryable ? 'FEDERATION.BACKCHANNEL_FAILED' : 'FEDERATION.BACKCHANNEL_REFUSED',
        outcome.retryable,
      );
    }
    await this.deps.deliveries.markDelivered(event.eventId, receiptKey);
  }
}
