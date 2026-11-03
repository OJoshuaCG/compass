import type { MailConnection } from './mail-connection-loader.js';

/** Fallos de conexión: el cursor no avanza y la fuente entra en retroceso. Códigos acotados. */
export const MAILBOX_FAILURE_CODES = [
  'HOST_REJECTED',
  'NETWORK',
  'TLS',
  'AUTH',
  'MAILBOX_UNAVAILABLE',
  'TIMEOUT',
] as const;
export type MailboxFailureCode = (typeof MAILBOX_FAILURE_CODES)[number];

export class MailboxConnectionError extends Error {
  constructor(readonly code: MailboxFailureCode) {
    // Sin texto del servidor ni host: el mensaje es solo el código.
    super(code);
    this.name = 'MailboxConnectionError';
  }
}

/** Un mensaje concreto no se pudo descargar: se registra como cuarentena y el sondeo sigue. */
export class MessageFetchError extends Error {
  constructor() {
    super('FETCH_FAILED');
    this.name = 'MessageFetchError';
  }
}

export interface MailboxMessageSummary {
  readonly uid: number;
  /** `INTERNALDATE` que fija el servidor propio al recibir el mensaje. */
  readonly internalDate: Date;
  readonly sizeBytes: number;
  /** Remitente del `ENVELOPE`; solo sirve para el prefiltro, nunca como autenticidad. */
  readonly envelopeFromAddress: string | null;
}

export interface RawMessage {
  readonly bytes: Uint8Array;
  /** `true` si el mensaje superó el tope y se cortó: nunca se analiza un mensaje truncado. */
  readonly truncated: boolean;
}

/** Sesión abierta de solo lectura (`EXAMINE`). */
export interface MailboxSession {
  readonly uidValidity: number;
  /** Mensajes con UID mayor que `afterUid` recibidos desde `since`. El filtrado final lo repite el caso de uso. */
  list(afterUid: number, since: Date): Promise<readonly MailboxMessageSummary[]>;
  /** Descarga acotada a `maxBytes`. */
  fetchRaw(uid: number, maxBytes: number): Promise<RawMessage>;
  close(): Promise<void>;
}

/**
 * Abre el buzón: aplica la guardia de red, TLS obligatorio y `EXAMINE`. Lanza `MailboxConnectionError`
 * con un código acotado; el texto del servidor nunca sale del adaptador.
 */
export interface MailboxConnector {
  open(connection: MailConnection): Promise<MailboxSession>;
}
