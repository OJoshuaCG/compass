import type {
  OutboundHttpsClient,
  OutboundHttpsFailureCode,
  OutboundHttpsRequest,
  OutboundHttpsResult,
} from '../application/ports/outbound-https-client.js';
import { TransportFailure } from './node-https-transport.js';
import type { HttpsTransport } from './node-https-transport.js';

const HTTPS_SCHEME = 'https:';
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_TIMEOUT_MS = 10_000;
const BYTES_PER_MEBIBYTE = 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = BYTES_PER_MEBIBYTE;
const REDIRECT_STATUS_MIN = 300;
const REDIRECT_STATUS_MAX = 399;

/** Nombre de encabezado válido: letras, dígitos y guion. Evita inyectar saltos de línea o separadores. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;
/** Último código de los caracteres de control C0 (NUL a US) y código de DEL. */
const LAST_C0_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;

/** Un valor de encabezado no puede traer saltos de línea ni caracteres de control. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code: number = character.codePointAt(0) ?? 0;
    if (code <= LAST_C0_CONTROL_CODE || code === DELETE_CODE) return true;
  }
  return false;
}

/**
 * Encabezados que la persona no puede fijar: los que enrutan la petición, los que delimitan el
 * mensaje (contrabando de peticiones) y los que sugieren un intermediario de confianza.
 */
const FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]);
const FORBIDDEN_HEADER_PREFIXES: readonly string[] = ['proxy-', 'sec-'];

/** El guardia de red del módulo de códigos entrantes cumple esta forma; aquí solo se exige lo que se usa. */
export interface HostResolver {
  resolve(
    host: string,
  ): Promise<
    | { readonly ok: true; readonly address: string }
    | { readonly ok: false; readonly code: 'HOST_UNRESOLVED' | 'HOST_NOT_ALLOWED' }
  >;
}

export interface GuardedHttpsClientOptions {
  readonly allowedPorts?: readonly number[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

function isHeaderAllowed(name: string, value: string): boolean {
  if (!HEADER_NAME_PATTERN.test(name)) return false;
  if (hasControlCharacter(value)) return false;
  const lowerCaseName: string = name.toLowerCase();
  if (FORBIDDEN_HEADER_NAMES.has(lowerCaseName)) return false;
  return !FORBIDDEN_HEADER_PREFIXES.some((prefix: string) => lowerCaseName.startsWith(prefix));
}

function failure(code: OutboundHttpsFailureCode): OutboundHttpsResult {
  return { ok: false, code };
}

export class GuardedHttpsClient implements OutboundHttpsClient {
  private readonly allowedPorts: readonly number[];
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly hostResolver: HostResolver,
    private readonly transport: HttpsTransport,
    options: GuardedHttpsClientOptions = {},
  ) {
    this.allowedPorts = options.allowedPorts ?? [DEFAULT_HTTPS_PORT];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  /**
   * Se valida en CADA envío, no solo al guardar la configuración: un nombre puede resolver hoy a una
   * IP pública y mañana a una interna (rebinding de DNS). Nunca sigue redirecciones: un destino
   * público podría redirigir a uno interno después de pasar la validación.
   */
  async send(request: OutboundHttpsRequest): Promise<OutboundHttpsResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url);
    } catch {
      return failure('URL_INVALID');
    }

    if (parsedUrl.protocol !== HTTPS_SCHEME) return failure('SCHEME_NOT_ALLOWED');
    // Credenciales en la dirección acabarían en registros y en el encabezado de autorización.
    if (parsedUrl.username !== '' || parsedUrl.password !== '') return failure('URL_INVALID');

    const port: number = parsedUrl.port === '' ? DEFAULT_HTTPS_PORT : Number(parsedUrl.port);
    if (!this.allowedPorts.includes(port)) return failure('PORT_NOT_ALLOWED');

    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (!isHeaderAllowed(name, value)) return failure('HEADER_NOT_ALLOWED');
      requestHeaders[name.toLowerCase()] = value;
    }

    // `URL.hostname` devuelve las direcciones IPv6 entre corchetes; el guardia espera la dirección sola.
    const hostname: string = parsedUrl.hostname.replace(/^\[|\]$/g, '');
    const hostCheck = await this.hostResolver.resolve(hostname);
    if (!hostCheck.ok) return failure(hostCheck.code);

    try {
      const response = await this.transport({
        address: hostCheck.address,
        hostname,
        port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: request.method,
        headers: requestHeaders,
        ...(request.body === undefined ? {} : { body: request.body }),
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
      });
      if (response.status >= REDIRECT_STATUS_MIN && response.status <= REDIRECT_STATUS_MAX) {
        return failure('REDIRECT_REFUSED');
      }
      return { ok: true, status: response.status, bodyText: response.bodyText };
    } catch (error: unknown) {
      return failure(error instanceof TransportFailure ? error.code : 'NETWORK_ERROR');
    }
  }
}
