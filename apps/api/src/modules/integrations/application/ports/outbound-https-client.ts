/**
 * Puerto del cliente HTTPS saliente de las integraciones (ADR 0047).
 *
 * Todo lo que la plataforma pide a una dirección definida por una persona (Telegram, la API de SMS)
 * pasa por este puerto. Los adaptadores deben impedir que esa dirección lleve a la red interna.
 */

export type OutboundHttpMethod = 'GET' | 'POST';

export interface OutboundHttpsRequest {
  /** Dirección completa. Solo se acepta el esquema `https`, sin usuario ni contraseña incrustados. */
  readonly url: string;
  readonly method: OutboundHttpMethod;
  /** Encabezados de la persona. Los que enrutan o enmarcan la petición se rechazan. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * Códigos estables de fallo. Ninguno incluye la dirección, los encabezados ni el cuerpo, porque
 * pueden contener secretos: solo el código llega a los registros y a la auditoría.
 */
export const OUTBOUND_HTTPS_FAILURE_CODES = [
  'URL_INVALID',
  'SCHEME_NOT_ALLOWED',
  'PORT_NOT_ALLOWED',
  'HEADER_NOT_ALLOWED',
  'HOST_UNRESOLVED',
  'HOST_NOT_ALLOWED',
  'REDIRECT_REFUSED',
  'TIMEOUT',
  'RESPONSE_TOO_LARGE',
  'NETWORK_ERROR',
] as const;

export type OutboundHttpsFailureCode = (typeof OUTBOUND_HTTPS_FAILURE_CODES)[number];

export type OutboundHttpsResult =
  | { readonly ok: true; readonly status: number; readonly bodyText: string }
  | { readonly ok: false; readonly code: OutboundHttpsFailureCode };

export interface OutboundHttpsClient {
  send(request: OutboundHttpsRequest): Promise<OutboundHttpsResult>;
}
