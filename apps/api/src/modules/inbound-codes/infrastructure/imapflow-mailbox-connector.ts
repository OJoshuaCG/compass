import { isIP } from 'node:net';

import { ImapFlow } from 'imapflow';

import type { MailConnection } from '../application/ports/mail-connection-loader.js';
import {
  MailboxConnectionError,
  MessageFetchError,
  type MailboxConnector,
  type MailboxFailureCode,
  type MailboxMessageSummary,
  type MailboxSession,
  type RawMessage,
} from '../application/ports/mailbox.js';
import type { NetworkGuard } from './network-guard.js';

/** Buzón que se examina: el sondeo solo mira la bandeja de entrada del servidor propio (ADR 0045). */
const MAILBOX_PATH = 'INBOX';
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
/** Sin actividad en el socket durante este tiempo la sesión se da por caída. */
const INACTIVITY_TIMEOUT_MS = 30_000;
/** Tope de mensajes cuyos metadatos se piden; el caso de uso aplica después su propio tope y ventana. */
const MAX_LISTED_MESSAGES = 500;
const MIN_TLS_VERSION = 'TLSv1.2';

/** Errores de verificación de certificado y de protocolo TLS de Node/OpenSSL. */
const TLS_ERROR_CODE_PATTERN =
  /^(ERR_TLS|ERR_SSL|CERT_|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|HOSTNAME_MISMATCH|ETLS|EPROTO)/;
/** Incluye los vencimientos propios de imapflow (conexión, saludo y mejora a TLS), que no usan códigos de Node. */
const TIMEOUT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ETIMEDOUT',
  'ETIMEOUT',
  'Timeout',
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'UPGRADE_TIMEOUT',
]);
/** Fallos de la mejora a TLS que imapflow reporta con su propio código (inyección tras STARTTLS). */
const TLS_UPGRADE_ERROR_CODES: ReadonlySet<string> = new Set(['STARTTLS_INJECTION']);

/** Subconjunto de `ImapFlow` que usa el adaptador; permite probarlo sin red. */
export interface ImapClient {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  connect(): Promise<void>;
  getMailboxLock(path: string, options: { readOnly: boolean }): Promise<{ release(): void }>;
  readonly mailbox: { readonly uidValidity: bigint } | false;
  search(query: { uid: string; since: Date }, options: { uid: true }): Promise<number[] | false>;
  fetch(
    range: string,
    query: { uid: true; envelope: true; internalDate: true; size: true },
    options: { uid: true },
  ): AsyncIterable<ImapFetchedSummary>;
  fetchOne(
    range: string,
    query: { uid: true; source: { maxLength: number } },
    options: { uid: true },
  ): Promise<{ readonly source?: Uint8Array } | false>;
  logout(): Promise<void>;
  close(): void;
}

export interface ImapFetchedSummary {
  readonly uid: number;
  readonly internalDate?: Date | string;
  readonly size?: number;
  readonly envelope?: { readonly from?: readonly { readonly address?: string }[] };
}

export interface ImapClientSettings {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly doSTARTTLS: boolean;
  readonly servername: string | undefined;
  readonly user: string;
  readonly password: string;
}

export type ImapClientFactory = (settings: ImapClientSettings) => ImapClient;

/**
 * Crea el cliente real. El registro de imapflow queda apagado (`logger: false`): sus líneas incluyen
 * comandos, y `LOGIN` lleva la contraseña. TLS verifica certificado y nombre; con `doSTARTTLS` la mejora a
 * TLS es obligatoria y un servidor que no la ofrezca hace fallar la conexión en lugar de continuar en claro.
 */
export const createImapFlowClient: ImapClientFactory = (settings) => {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    doSTARTTLS: settings.doSTARTTLS,
    ...(settings.servername === undefined ? {} : { servername: settings.servername }),
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    tls: { rejectUnauthorized: true, minVersion: MIN_TLS_VERSION },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: INACTIVITY_TIMEOUT_MS,
  });
  return client as unknown as ImapClient;
};

/** Traduce cualquier error de la biblioteca a un código acotado; el texto del servidor no sale de aquí. */
export function classifyImapError(error: unknown): MailboxFailureCode {
  if (error instanceof MailboxConnectionError) return error.code;
  const details =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  if (details['authenticationFailed'] === true) return 'AUTH';
  // `tlsFailed` cubre el servidor que no ofrece STARTTLS (degradación) y los fallos del apretón de manos.
  if (details['tlsFailed'] === true) return 'TLS';
  const code = typeof details['code'] === 'string' ? details['code'] : '';
  if (TLS_ERROR_CODE_PATTERN.test(code) || TLS_UPGRADE_ERROR_CODES.has(code)) return 'TLS';
  if (TIMEOUT_ERROR_CODES.has(code)) return 'TIMEOUT';
  return 'NETWORK';
}

const CONNECTION_LEVEL_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'NoConnection',
  'EConnectionClosed',
  'ClosedAfterConnectTLS',
  'ClosedAfterConnectText',
  'StateLogout',
  ...TIMEOUT_ERROR_CODES,
  ...TLS_UPGRADE_ERROR_CODES,
]);

/** `true` si el error indica que la sesión entera cayó, no que un mensaje concreto falló. */
function isConnectionLevelError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'tlsFailed' in error &&
    error.tlsFailed === true
  ) {
    return true;
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  if (typeof code !== 'string') return false;
  return CONNECTION_LEVEL_ERROR_CODES.has(code) || TLS_ERROR_CODE_PATTERN.test(code);
}

export class ImapFlowMailboxConnector implements MailboxConnector {
  constructor(
    private readonly guard: NetworkGuard,
    private readonly createClient: ImapClientFactory = createImapFlowClient,
  ) {}

  async open(connection: MailConnection): Promise<MailboxSession> {
    // La IP validada es a la que se conecta; el nombre original se conserva para verificar el certificado.
    const resolved = await this.guard.resolve(connection.host);
    if (!resolved.ok) throw new MailboxConnectionError('HOST_REJECTED');

    const client = this.createClient({
      host: resolved.address,
      port: connection.port,
      secure: connection.tlsMode === 'tls',
      doSTARTTLS: connection.tlsMode === 'starttls',
      // SNI con una IP literal no es válido; para un nombre se manda el nombre, no la IP fijada.
      servername: isIP(connection.host) === 0 ? connection.host : undefined,
      user: connection.username,
      password: connection.password,
    });
    // Sin escucha de `error`, un fallo asíncrono del socket tumbaría el proceso con detalles del servidor.
    client.on('error', () => undefined);

    try {
      await client.connect();
    } catch (error) {
      closeQuietly(client);
      throw new MailboxConnectionError(classifyImapError(error));
    }

    let lock: { release(): void };
    try {
      // `EXAMINE`: el sondeo nunca modifica el buzón (no marca leídos ni borra).
      lock = await client.getMailboxLock(MAILBOX_PATH, { readOnly: true });
    } catch {
      closeQuietly(client);
      throw new MailboxConnectionError('MAILBOX_UNAVAILABLE');
    }

    const mailbox = client.mailbox;
    if (mailbox === false) {
      lock.release();
      closeQuietly(client);
      throw new MailboxConnectionError('MAILBOX_UNAVAILABLE');
    }
    return new ImapFlowMailboxSession(client, lock, Number(mailbox.uidValidity));
  }
}

function closeQuietly(client: ImapClient): void {
  try {
    client.close();
  } catch {
    // Cerrar un cliente ya caído puede lanzar; no hay nada más que liberar.
  }
}

class ImapFlowMailboxSession implements MailboxSession {
  constructor(
    private readonly client: ImapClient,
    private readonly lock: { release(): void },
    readonly uidValidity: number,
  ) {}

  async list(afterUid: number, since: Date): Promise<readonly MailboxMessageSummary[]> {
    try {
      // `N:*` siempre incluye el último mensaje aunque su UID sea menor que N: se vuelve a filtrar abajo.
      const matchingUids = await this.client.search(
        { uid: `${String(afterUid + 1)}:*`, since },
        { uid: true },
      );
      if (matchingUids === false) return [];
      const newestUids = matchingUids
        .filter((uid) => uid > afterUid)
        .sort((left, right) => right - left)
        .slice(0, MAX_LISTED_MESSAGES);
      if (newestUids.length === 0) return [];

      const summaries: MailboxMessageSummary[] = [];
      const range = newestUids.join(',');
      for await (const message of this.client.fetch(
        range,
        { uid: true, envelope: true, internalDate: true, size: true },
        { uid: true },
      )) {
        if (message.uid <= afterUid) continue;
        const internalDate = toDate(message.internalDate);
        if (internalDate === null) continue;
        summaries.push({
          uid: message.uid,
          internalDate,
          sizeBytes: message.size ?? 0,
          envelopeFromAddress: message.envelope?.from?.[0]?.address?.toLowerCase() ?? null,
        });
      }
      return summaries;
    } catch (error) {
      throw new MailboxConnectionError(classifyImapError(error));
    }
  }

  async fetchRaw(uid: number, maxBytes: number): Promise<RawMessage> {
    let fetched: { readonly source?: Uint8Array } | false;
    try {
      // Se pide un byte de más: si llega, el mensaje supera el tope y no se analiza.
      fetched = await this.client.fetchOne(
        String(uid),
        { uid: true, source: { maxLength: maxBytes + 1 } },
        { uid: true },
      );
    } catch (error) {
      // Un fallo del socket es de conexión; cualquier otro es de este mensaje.
      if (isConnectionLevelError(error)) throw new MailboxConnectionError(classifyImapError(error));
      throw new MessageFetchError();
    }
    if (fetched === false || fetched.source === undefined) throw new MessageFetchError();
    const truncated = fetched.source.length > maxBytes;
    return { bytes: truncated ? fetched.source.subarray(0, maxBytes) : fetched.source, truncated };
  }

  async close(): Promise<void> {
    try {
      this.lock.release();
      await this.client.logout();
    } catch {
      // Si liberar o cerrar la sesión falla, se corta el socket para no dejarlo abierto.
      closeQuietly(this.client);
    }
  }
}

function toDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
