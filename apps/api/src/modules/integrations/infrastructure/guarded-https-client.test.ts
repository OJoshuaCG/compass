import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { GuardedHttpsClient } from './guarded-https-client.js';
import type { HostResolver } from './guarded-https-client.js';
import { TransportFailure } from './node-https-transport.js';
import type { TransportRequest, TransportResponse } from './node-https-transport.js';

const PUBLIC_ADDRESS = '203.0.113.10';
const SECRET_TOKEN = 'token-secreto-que-no-debe-salir';

function buildAllowingResolver(address: string = PUBLIC_ADDRESS): {
  resolve: Mock<HostResolver['resolve']>;
} {
  return {
    resolve: vi.fn<HostResolver['resolve']>(() => Promise.resolve({ ok: true as const, address })),
  };
}

function buildTransport(status = 200, bodyText = '{}') {
  return vi.fn<(request: TransportRequest) => Promise<TransportResponse>>(() =>
    Promise.resolve({ status, bodyText }),
  );
}

describe('GuardedHttpsClient', () => {
  it('conecta a la IP validada, conserva el nombre y manda ruta, consulta y encabezados en minúsculas', async () => {
    const resolver = buildAllowingResolver();
    const transport = buildTransport(200, '{"ok":true}');
    const client = new GuardedHttpsClient(resolver, transport);

    const result = await client.send({
      url: 'https://api.example.test/v1/messages?since=5',
      method: 'GET',
      headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
    });

    expect(result).toEqual({ ok: true, status: 200, bodyText: '{"ok":true}' });
    expect(resolver.resolve).toHaveBeenCalledWith('api.example.test');
    const sent = transport.mock.calls[0]?.[0];
    expect(sent?.address).toBe(PUBLIC_ADDRESS);
    expect(sent?.hostname).toBe('api.example.test');
    expect(sent?.port).toBe(443);
    expect(sent?.path).toBe('/v1/messages?since=5');
    expect(sent?.headers).toEqual({ authorization: `Bearer ${SECRET_TOKEN}` });
  });

  it('rechaza cualquier esquema distinto de https sin tocar la red', async () => {
    const resolver = buildAllowingResolver();
    const transport = buildTransport();
    const client = new GuardedHttpsClient(resolver, transport);

    for (const url of [
      'http://api.example.test/',
      'ftp://api.example.test/',
      'file:///etc/passwd',
    ]) {
      const result = await client.send({ url, method: 'GET' });
      expect(result).toEqual({ ok: false, code: 'SCHEME_NOT_ALLOWED' });
    }
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it('rechaza una dirección ilegible o con usuario y contraseña incrustados', async () => {
    const transport = buildTransport();
    const client = new GuardedHttpsClient(buildAllowingResolver(), transport);

    expect(await client.send({ url: 'no es una url', method: 'GET' })).toEqual({
      ok: false,
      code: 'URL_INVALID',
    });
    expect(
      await client.send({ url: 'https://usuario:clave@api.example.test/', method: 'GET' }),
    ).toEqual({ ok: false, code: 'URL_INVALID' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('solo permite el puerto 443 salvo que el despliegue autorice otros', async () => {
    const transport = buildTransport();
    const strictClient = new GuardedHttpsClient(buildAllowingResolver(), transport);
    const permissiveClient = new GuardedHttpsClient(buildAllowingResolver(), transport, {
      allowedPorts: [443, 8443],
    });

    expect(
      await strictClient.send({ url: 'https://api.example.test:8443/', method: 'GET' }),
    ).toEqual({
      ok: false,
      code: 'PORT_NOT_ALLOWED',
    });
    expect(await strictClient.send({ url: 'https://api.example.test:22/', method: 'GET' })).toEqual(
      {
        ok: false,
        code: 'PORT_NOT_ALLOWED',
      },
    );
    expect(
      (await permissiveClient.send({ url: 'https://api.example.test:8443/', method: 'GET' })).ok,
    ).toBe(true);
  });

  it.each([
    ['Host', 'otro.example.test'],
    ['Content-Length', '0'],
    ['Transfer-Encoding', 'chunked'],
    ['Connection', 'keep-alive'],
    ['X-Forwarded-For', '10.0.0.1'],
    ['Proxy-Authorization', 'Basic abc'],
    ['Sec-Fetch-Mode', 'cors'],
    ['X-Valido', 'linea1\r\nX-Inyectado: 1'],
    ['Nombre con espacio', 'valor'],
  ])('rechaza el encabezado %s', async (name: string, value: string) => {
    const transport = buildTransport();
    const client = new GuardedHttpsClient(buildAllowingResolver(), transport);

    const result = await client.send({
      url: 'https://api.example.test/',
      method: 'GET',
      headers: { [name]: value },
    });

    expect(result).toEqual({ ok: false, code: 'HEADER_NOT_ALLOWED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('propaga el rechazo del guardia de red y no conecta', async () => {
    const transport = buildTransport();
    const notAllowed: HostResolver = {
      resolve: () => Promise.resolve({ ok: false as const, code: 'HOST_NOT_ALLOWED' as const }),
    };
    const unresolved: HostResolver = {
      resolve: () => Promise.resolve({ ok: false as const, code: 'HOST_UNRESOLVED' as const }),
    };

    expect(
      await new GuardedHttpsClient(notAllowed, transport).send({
        url: 'https://interno.example.test/',
        method: 'GET',
      }),
    ).toEqual({ ok: false, code: 'HOST_NOT_ALLOWED' });
    expect(
      await new GuardedHttpsClient(unresolved, transport).send({
        url: 'https://nada.example.test/',
        method: 'GET',
      }),
    ).toEqual({ ok: false, code: 'HOST_UNRESOLVED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('valida el destino en cada envío, no solo la primera vez (rebinding de DNS)', async () => {
    const resolver = {
      resolve: vi
        .fn()
        .mockResolvedValueOnce({ ok: true as const, address: PUBLIC_ADDRESS })
        .mockResolvedValueOnce({ ok: false as const, code: 'HOST_NOT_ALLOWED' as const }),
    };
    const transport = buildTransport();
    const client = new GuardedHttpsClient(resolver, transport);
    const request = { url: 'https://api.example.test/', method: 'GET' as const };

    expect((await client.send(request)).ok).toBe(true);
    expect(await client.send(request)).toEqual({ ok: false, code: 'HOST_NOT_ALLOWED' });
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('entrega al guardia una IPv6 literal sin corchetes', async () => {
    const resolver = buildAllowingResolver('2001:db8::1');
    const client = new GuardedHttpsClient(resolver, buildTransport());

    await client.send({ url: 'https://[2001:db8::1]/', method: 'GET' });

    expect(resolver.resolve).toHaveBeenCalledWith('2001:db8::1');
  });

  it.each([301, 302, 307, 308, 399])(
    'rechaza la redirección %i sin seguirla',
    async (status: number) => {
      const transport = buildTransport(status);
      const client = new GuardedHttpsClient(buildAllowingResolver(), transport);

      const result = await client.send({ url: 'https://api.example.test/', method: 'GET' });

      expect(result).toEqual({ ok: false, code: 'REDIRECT_REFUSED' });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it('devuelve como respuesta normal un 400 o un 500 del tercero', async () => {
    for (const status of [400, 404, 500]) {
      const client = new GuardedHttpsClient(buildAllowingResolver(), buildTransport(status, 'x'));
      const result = await client.send({ url: 'https://api.example.test/', method: 'GET' });
      expect(result).toEqual({ ok: true, status, bodyText: 'x' });
    }
  });

  it('traduce los fallos del transporte a códigos estables', async () => {
    for (const code of ['TIMEOUT', 'RESPONSE_TOO_LARGE', 'NETWORK_ERROR'] as const) {
      const client = new GuardedHttpsClient(buildAllowingResolver(), () =>
        Promise.reject(new TransportFailure(code)),
      );
      expect(await client.send({ url: 'https://api.example.test/', method: 'GET' })).toEqual({
        ok: false,
        code,
      });
    }
    const unexpected = new GuardedHttpsClient(buildAllowingResolver(), () =>
      Promise.reject(new Error(`detalle interno con ${SECRET_TOKEN}`)),
    );
    expect(await unexpected.send({ url: 'https://api.example.test/', method: 'GET' })).toEqual({
      ok: false,
      code: 'NETWORK_ERROR',
    });
  });

  it('ningún resultado de fallo contiene la dirección ni el secreto de los encabezados', async () => {
    const client = new GuardedHttpsClient(buildAllowingResolver(), () =>
      Promise.reject(new Error(`falló ${SECRET_TOKEN}`)),
    );

    const result = await client.send({
      url: `https://api.example.test/ruta-privada?clave=${SECRET_TOKEN}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
    });

    const serialized: string = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET_TOKEN);
    expect(serialized).not.toContain('ruta-privada');
  });
});
