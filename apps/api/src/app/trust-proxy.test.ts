import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createLogger } from '../shared/infrastructure/logger.js';
import { createApp } from './create-app.js';
import { parseTrustProxy } from './trust-proxy.js';
import type { TrustProxySetting } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('keeps the two original values', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
  });

  it('accepts a number of hops from 1 to 10', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10')).toBe(10);
  });

  it('rejects zero hops, too many hops and signed or decimal numbers', () => {
    for (const value of ['0', '11', '-1', '1.5', '01x']) {
      expect(parseTrustProxy(value), value).toBeUndefined();
    }
  });

  it('accepts a list of addresses and CIDR ranges, with spaces around the commas', () => {
    expect(parseTrustProxy('10.0.0.5, 192.168.0.0/16 ,2001:db8::/32')).toEqual([
      '10.0.0.5',
      '192.168.0.0/16',
      '2001:db8::/32',
    ]);
  });

  it('rejects ranges that trust everything and malformed entries', () => {
    const invalid = [
      '0.0.0.0/0',
      '::/0',
      '0.0.0.0/1',
      '128.0.0.0/7',
      '::/1',
      '8000::/15',
      '::ffff:0.0.0.0/96',
      '::ffff:10.0.0.0/103',
      '10.0.0.0/33',
      '2001:db8::/129',
      '10.0.0.0/abc',
      '10.0.0.0/8/8',
      '999.1.1.1',
      'loopback',
      'example.com',
      '10.0.0.1,',
      '',
      ',',
      '10.0.0.1,,10.0.0.2',
    ];
    for (const value of invalid) {
      expect(parseTrustProxy(value), value).toBeUndefined();
    }
  });
});

describe('trustProxy applied by createApp', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** Levanta la aplicación con una ruta auxiliar que devuelve la IP que Fastify resolvió. */
  async function resolvedIp(
    trustProxy: TrustProxySetting | undefined,
    remoteAddress: string,
    forwardedFor: string,
  ): Promise<string> {
    app = await createApp({
      logger: createLogger({ level: 'silent' }),
      ...(trustProxy === undefined ? {} : { trustProxy }),
    });
    const fastify = app.getHttpAdapter().getInstance();
    fastify.get('/__resolved-ip', (request) => ({ ip: request.ip }));
    await app.init();
    await fastify.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/__resolved-ip',
      remoteAddress,
      headers: { 'x-forwarded-for': forwardedFor },
    });
    return response.json<{ ip: string }>().ip;
  }

  it('ignores X-Forwarded-For by default', async () => {
    expect(await resolvedIp(undefined, '10.1.2.3', '203.0.113.9')).toBe('10.1.2.3');
  });

  it('takes the forwarded address only when the direct peer is in the trusted list', async () => {
    const trusted = ['10.0.0.0/8'];
    expect(await resolvedIp(trusted, '10.1.2.3', '203.0.113.9')).toBe('203.0.113.9');
  });

  it('does not let an untrusted peer spoof its address with the header', async () => {
    const trusted = ['10.0.0.0/8'];
    expect(await resolvedIp(trusted, '198.51.100.7', '203.0.113.9')).toBe('198.51.100.7');
  });

  it('with one hop, trusts the nearest proxy and not the addresses the client wrote', async () => {
    expect(await resolvedIp(1, '10.1.2.3', '198.51.100.99, 203.0.113.9')).toBe('203.0.113.9');
  });

  // Documenta la limitación de los saltos: no validan al par directo. Si esta prueba empieza a
  // fallar porque Fastify cambió, hay que revisar la advertencia de §6.4 y del runbook.
  it('with hops, a peer that reaches the API directly can spoof its address', async () => {
    expect(await resolvedIp(1, '198.51.100.7', '203.0.113.9')).toBe('203.0.113.9');
  });

  it('with two hops, takes the second nearest address from the right', async () => {
    expect(await resolvedIp(2, '10.1.2.3', '198.51.100.99, 203.0.113.9, 10.1.2.4')).toBe(
      '203.0.113.9',
    );
  });
});
