import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NodeSigningKeyGenerator } from '../../../crypto/index.js';
import { createOidcProvider } from './create-oidc-provider.js';

/** Un almacenamiento vacío basta: aquí solo se comprueba que la configuración la acepta el paquete. */
class EmptyAdapter {
  upsert(): Promise<void> {
    return Promise.resolve();
  }
  find(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  findByUid(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  findByUserCode(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  consume(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }
  revokeByGrantId(): Promise<void> {
    return Promise.resolve();
  }
}

let server: Server;
let baseUrl: string;
let publicJwk: Readonly<Record<string, unknown>>;

beforeAll(async () => {
  const generated = new NodeSigningKeyGenerator().generate('ES256');
  publicJwk = generated.publicJwk;
  const provider = createOidcProvider({
    issuer: 'http://localhost',
    adapter: EmptyAdapter,
    privateJwks: [{ ...generated.privateJwk, kid: generated.kid, alg: 'ES256', use: 'sig' }],
    cookieKeys: ['test-cookie-key-0123456789abcdef0123456789'],
    idTokenSigningAlg: 'ES256',
    interactionUrl: (uid) => `/sso/interaction/${uid}`,
    loadAccountClaims: () => Promise.resolve(null),
  });
  server = createServer(provider.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

/** El host de los endpoints sale de la petición; lo que se fija es la ruta. */
const pathOf = (value: unknown): string => new URL(String(value)).pathname;

describe('createOidcProvider', () => {
  it('publica un descubrimiento solo con código, PKCE S256 y firma con la clave propia', async () => {
    const response = await fetch(`${baseUrl}/.well-known/openid-configuration`, {
      headers: { host: 'localhost' },
    });
    const discovery = (await response.json()) as Record<string, unknown>;

    expect(discovery['issuer']).toBe('http://localhost');
    expect(discovery['response_types_supported']).toEqual(['code']);
    expect(discovery['grant_types_supported']).toEqual(
      expect.not.arrayContaining(['implicit', 'password']),
    );
    expect(discovery['code_challenge_methods_supported']).toEqual(['S256']);
    expect(discovery['id_token_signing_alg_values_supported']).toEqual(['ES256']);
    expect(discovery['backchannel_logout_supported']).toBe(true);
    expect(pathOf(discovery['jwks_uri'])).toBe('/oidc/jwks');
    expect(pathOf(discovery['token_endpoint'])).toBe('/oidc/token');
    expect(pathOf(discovery['authorization_endpoint'])).toBe('/oidc/auth');
    expect(discovery['registration_endpoint']).toBeUndefined();
    expect(discovery['device_authorization_endpoint']).toBeUndefined();
  });

  it('publica en /jwks solo la parte pública de la clave activa', async () => {
    const response = await fetch(`${baseUrl}/oidc/jwks`, { headers: { host: 'localhost' } });
    const body = (await response.json()) as { keys: Record<string, unknown>[] };

    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]?.['x']).toBe(publicJwk['x']);
    expect(body.keys[0]).not.toHaveProperty('d');
  });
});
