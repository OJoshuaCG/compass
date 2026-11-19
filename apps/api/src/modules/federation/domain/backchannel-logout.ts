/**
 * Aviso de cierre de sesión por canal trasero (OIDC Back-Channel Logout 1.0, ADR 0052).
 *
 * Sin dependencias de framework ni de Node. El evento del outbox lleva SOLO identificadores: el
 * `logout_token` firmado nunca se guarda, se firma en cada intento.
 */

/** Agregado y tipo del evento en `outbox_events`. */
export const BACKCHANNEL_LOGOUT_AGGREGATE = 'oidc_session';
export const BACKCHANNEL_LOGOUT_EVENT_TYPE = 'oidc.backchannel_logout';

/** Evento de la especificación que identifica un logout_token. */
export const BACKCHANNEL_LOGOUT_EVENT_URI = 'http://schemas.openid.net/event/backchannel-logout';

/** Vigencia del logout_token: se firma en cada intento, así que basta con un margen corto de reloj. */
export const LOGOUT_TOKEN_LIFETIME_SECONDS = 120;

/** Aplicación y sesión del proveedor (`sid`) a las que hay que avisar de que la sesión terminó. */
export interface BackchannelLogoutTarget {
  readonly clientId: string;
  readonly sid: string;
}

export type BackchannelLogoutErrorCode =
  | 'FEDERATION.BACKCHANNEL_PAYLOAD_INVALID'
  | 'FEDERATION.BACKCHANNEL_REFUSED'
  | 'FEDERATION.BACKCHANNEL_FAILED';

/**
 * El aviso no pudo entregarse. `retryable = false` indica algo que reintentar no arregla (destino no
 * permitido, rechazo permanente del cliente). Ni la dirección, ni el token, ni la respuesta del cliente
 * entran en el mensaje.
 */
export class BackchannelLogoutError extends Error {
  readonly code: BackchannelLogoutErrorCode;
  readonly retryable: boolean;

  constructor(code: BackchannelLogoutErrorCode, retryable: boolean) {
    super('Back-channel logout could not be delivered');
    this.name = 'BackchannelLogoutError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function serializeBackchannelLogoutTarget(
  target: BackchannelLogoutTarget,
): Record<string, string> {
  return { clientId: target.clientId, sid: target.sid };
}

/** Valida el jsonb del evento; una forma inesperada es un error NO reintentable (cuarentena). */
export function parseBackchannelLogoutPayload(payload: unknown): BackchannelLogoutTarget {
  if (typeof payload === 'object' && payload !== null) {
    const { clientId, sid } = payload as Record<string, unknown>;
    if (typeof clientId === 'string' && clientId !== '' && typeof sid === 'string' && sid !== '') {
      return { clientId, sid };
    }
  }
  throw new BackchannelLogoutError('FEDERATION.BACKCHANNEL_PAYLOAD_INVALID', false);
}

/** Clave de idempotencia del acuse de entrega: un aviso por aplicación y sesión del proveedor. */
export const backchannelLogoutReceiptKey = (target: BackchannelLogoutTarget): string =>
  `backchannel:${target.clientId}:${target.sid}`;
