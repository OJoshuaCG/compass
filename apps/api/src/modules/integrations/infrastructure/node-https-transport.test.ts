import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { TransportFailure, createNodeHttpsTransport } from './node-https-transport.js';
import type { TransportRequest } from './node-https-transport.js';

/**
 * Se prueba el transporte real con `http.request` contra un servidor local: la lógica de tiempo,
 * tamaño, encabezados y redirecciones es la misma; solo cambia la capa TLS, que no se puede simular
 * sin un certificado.
 */
const LOOPBACK_ADDRESS = '127.0.0.1';
const ORIGINAL_HOSTNAME = 'api.example.test';

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

let activeServer: Server | undefined;

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse, captured: CapturedRequest) => void,
): Promise<{ port: number; captured: CapturedRequest[] }> {
  const captured: CapturedRequest[] = [];
  const server: Server = createServer((request, response) => {
    const bodyChunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
    request.on('end', () => {
      const entry: CapturedRequest = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(bodyChunks).toString('utf8'),
      };
      captured.push(entry);
      handler(request, response, entry);
    });
  });
  activeServer = server;
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK_ADDRESS, resolve));
  return { port: (server.address() as AddressInfo).port, captured };
}

function buildRequest(port: number, overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    address: LOOPBACK_ADDRESS,
    hostname: ORIGINAL_HOSTNAME,
    port,
    path: '/v1/mensajes?desde=5',
    method: 'GET',
    headers: {},
    timeoutMs: 2_000,
    maxResponseBytes: 1_024,
    ...overrides,
  };
}

const transport = createNodeHttpsTransport(httpRequest);

afterEach(async () => {
  const server: Server | undefined = activeServer;
  activeServer = undefined;
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

describe('createNodeHttpsTransport', () => {
  it('conecta a la IP indicada y manda el nombre original en Host, con ruta y consulta', async () => {
    const { port, captured } = await startServer((_request, response) => {
      response.statusCode = 200;
      response.end('hola');
    });

    const result = await transport(buildRequest(port, { headers: { authorization: 'Bearer x' } }));

    expect(result).toEqual({ status: 200, bodyText: 'hola' });
    expect(captured[0]?.url).toBe('/v1/mensajes?desde=5');
    expect(captured[0]?.headers.host).toBe(`${ORIGINAL_HOSTNAME}:${String(port)}`);
    expect(captured[0]?.headers.authorization).toBe('Bearer x');
  });

  it('manda el cuerpo de un POST con su longitud en bytes, también con caracteres multibyte', async () => {
    const { port, captured } = await startServer((_request, response) => response.end('ok'));
    const body = '{"texto":"ñandú ✓"}';

    await transport(buildRequest(port, { method: 'POST', body }));

    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.body).toBe(body);
    expect(captured[0]?.headers['content-length']).toBe(String(Buffer.byteLength(body, 'utf8')));
  });

  it('entrega tal cual una redirección y no la sigue', async () => {
    const { port, captured } = await startServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader('location', 'http://127.0.0.1:1/interno');
      response.end();
    });

    const result = await transport(buildRequest(port));

    expect(result.status).toBe(302);
    expect(captured).toHaveLength(1);
  });

  it('corta una respuesta que supera el tope de bytes', async () => {
    const { port } = await startServer((_request, response) => {
      response.end('x'.repeat(5_000));
    });

    await expect(transport(buildRequest(port, { maxResponseBytes: 1_000 }))).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });

  it('acepta una respuesta exactamente igual al tope', async () => {
    const { port } = await startServer((_request, response) => response.end('x'.repeat(1_000)));

    const result = await transport(buildRequest(port, { maxResponseBytes: 1_000 }));

    expect(result.bodyText).toHaveLength(1_000);
  });

  it('agota el tiempo cuando el servidor no responde', async () => {
    const { port } = await startServer(() => {
      // No responde nunca.
    });

    await expect(transport(buildRequest(port, { timeoutMs: 100 }))).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('agota el tiempo aunque el servidor gotee la respuesta sin terminarla', async () => {
    const { port } = await startServer((_request, response) => {
      response.write('a');
      const interval = setInterval(() => {
        response.write('a');
      }, 20);
      response.on('close', () => {
        clearInterval(interval);
      });
    });

    await expect(
      transport(buildRequest(port, { timeoutMs: 150, maxResponseBytes: 1_000_000 })),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('informa un error de red con un código estable cuando la conexión se rechaza', async () => {
    const { port } = await startServer((_request, response) => {
      response.end();
    });
    await new Promise<void>((resolve) => {
      activeServer?.close(() => {
        resolve();
      });
    });
    activeServer = undefined;

    const failure: unknown = await transport(buildRequest(port)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TransportFailure);
    expect((failure as TransportFailure).code).toBe('NETWORK_ERROR');
    expect((failure as TransportFailure).message).toBe('NETWORK_ERROR');
  });
});
