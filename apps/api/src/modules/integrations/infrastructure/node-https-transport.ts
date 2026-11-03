import { isIP } from 'node:net';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';

/** Puerto por defecto de HTTPS; el encabezado `Host` lo omite. */
const DEFAULT_HTTPS_PORT = 443;

export type TransportFailureCode = 'TIMEOUT' | 'RESPONSE_TOO_LARGE' | 'NETWORK_ERROR';

export class TransportFailure extends Error {
  constructor(readonly code: TransportFailureCode) {
    // El mensaje es solo el código: nunca se arma con la dirección ni con datos de la respuesta.
    super(code);
    this.name = 'TransportFailure';
  }
}

export interface TransportRequest {
  /** IP ya validada por el guardia de red: a ella se conecta, no al nombre. */
  readonly address: string;
  /** Nombre original: sirve para verificar el certificado y para el encabezado `Host`. */
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export interface TransportResponse {
  readonly status: number;
  readonly bodyText: string;
}

export type HttpsTransport = (request: TransportRequest) => Promise<TransportResponse>;

/** Forma de `https.request`; en las pruebas se inyecta `http.request` contra un servidor local. */
export type RequestFunction = (
  options: https.RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

function buildHostHeader(hostname: string, port: number): string {
  const hostForHeader: string = hostname.includes(':') ? `[${hostname}]` : hostname;
  return port === DEFAULT_HTTPS_PORT ? hostForHeader : `${hostForHeader}:${String(port)}`;
}

export function createNodeHttpsTransport(
  requestFunction: RequestFunction = https.request,
): HttpsTransport {
  return (transportRequest: TransportRequest): Promise<TransportResponse> =>
    new Promise<TransportResponse>((resolve, reject) => {
      let isSettled = false;
      // `fail` y `succeed` solo se invocan desde el temporizador y los eventos de la petición, es decir,
      // después de que `deadlineTimer` y `clientRequest` ya existen.
      const fail = (code: TransportFailureCode): void => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(deadlineTimer);
        clientRequest.destroy();
        reject(new TransportFailure(code));
      };

      const succeed = (response: TransportResponse): void => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(deadlineTimer);
        resolve(response);
      };

      const requestBodyBytes: Buffer | undefined =
        transportRequest.body === undefined
          ? undefined
          : Buffer.from(transportRequest.body, 'utf8');

      const headers: Record<string, string> = {
        ...transportRequest.headers,
        host: buildHostHeader(transportRequest.hostname, transportRequest.port),
      };
      if (requestBodyBytes !== undefined) {
        headers['content-length'] = String(requestBodyBytes.length);
      }

      const options: https.RequestOptions = {
        host: transportRequest.address,
        port: transportRequest.port,
        path: transportRequest.path,
        method: transportRequest.method,
        headers,
        // Sin agente compartido: ninguna conexión se reutiliza entre destinos distintos.
        agent: false,
      };
      // Una IP literal no se manda como SNI; con un nombre, el certificado se verifica contra él.
      if (isIP(transportRequest.hostname) === 0) {
        options.servername = transportRequest.hostname;
      }

      const deadlineTimer: NodeJS.Timeout = setTimeout(() => {
        fail('TIMEOUT');
      }, transportRequest.timeoutMs);

      const clientRequest: ClientRequest = requestFunction(options, (response: IncomingMessage) => {
        const receivedChunks: Buffer[] = [];
        let receivedBytes = 0;

        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > transportRequest.maxResponseBytes) {
            fail('RESPONSE_TOO_LARGE');
            return;
          }
          receivedChunks.push(chunk);
        });
        response.on('end', () => {
          succeed({
            status: response.statusCode ?? 0,
            bodyText: Buffer.concat(receivedChunks).toString('utf8'),
          });
        });
        response.on('error', () => {
          fail('NETWORK_ERROR');
        });
      });

      clientRequest.on('error', () => {
        fail('NETWORK_ERROR');
      });
      clientRequest.end(requestBodyBytes);
    });
}
