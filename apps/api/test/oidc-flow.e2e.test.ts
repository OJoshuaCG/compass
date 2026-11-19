/**
 * Flujo completo de Authorization Code con PKCE contra el proveedor OIDC real montado sobre la API y
 * PostgreSQL (ADR 0050-0052): registro del cliente, login por la sesión de Compass, consentimiento
 * automático (cliente interno), intercambio del código y verificación del id token.
 */
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { STRONG_PASSWORD, TestClient, enroll, freshTotp, startEnvironment } from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

const REDIRECT_URI = 'http://localhost:9999/callback';
const SESSION_COOKIE = '__Host-session';

let env: E2eEnvironment;
let root: EnrolledSession;
let rootUserId: string;
let clientId: string;
let clientSecret: string;
let externalClientId: string;

const base64Url = (data: Buffer): string => data.toString('base64url');

/** Navegador mínimo: conserva las cookies del proveedor y envía la de Compass solo cuando se le pide. */
class Browser {
  private readonly jar = new Map<string, string>();

  constructor(private readonly compassCookie: () => string | null) {}

  async get(path: string, options: { withCompass: boolean }) {
    return this.send('GET', path, options);
  }

  async post(path: string, options: { withCompass: boolean; origin?: string }) {
    return this.send('POST', path, options);
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    options: { withCompass: boolean; origin?: string },
  ) {
    const cookies = [...this.jar].map(([name, value]) => `${name}=${value}`);
    const compass = this.compassCookie();
    if (options.withCompass && compass !== null) cookies.push(`${SESSION_COOKIE}=${compass}`);
    const response = await env.app.inject({
      method,
      url: path,
      headers: {
        ...(cookies.length > 0 ? { cookie: cookies.join('; ') } : {}),
        ...(options.origin === undefined ? {} : { origin: options.origin }),
      },
    });
    for (const cookie of response.cookies) {
      if (cookie.value === '') this.jar.delete(cookie.name);
      else this.jar.set(cookie.name, cookie.value);
    }
    return response;
  }
}

/** Ruta y consulta de una cabecera `Location`, absoluta o relativa. */
const locationPath = (location: string | string[] | undefined): string => {
  const value = Array.isArray(location) ? location[0] : location;
  if (value === undefined) throw new Error('missing Location header');
  const url = new URL(value, 'http://app.test');
  return `${url.pathname}${url.search}`;
};

const decodeJwt = (token: string) => {
  const [header, payload, signature] = token.split('.') as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    signingInput: `${header}.${payload}`,
    signature: Buffer.from(signature, 'base64url'),
  };
};

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'), { oidc: true });
  const created = await env.bootstrapOrganization({
    slug: 'flow',
    rootEmail: 'root@flow.test',
    rootName: 'Ada Lovelace',
  });
  rootUserId = created.rootUserId;
  const client = new TestClient(env, '203.0.113.140');
  await client.post('/auth/login', { email: 'root@flow.test', password: STRONG_PASSWORD });
  root = await enroll(env, client);
  // `sso.clients.manage` exige reautenticación reciente (catálogo de permisos).
  expect(
    (await root.client.post('/auth/reauth', { code: freshTotp(root.secret, env.clock) })).status,
  ).toBe(204);

  const registered = await root.client.post<{
    data: { client: { clientId: string }; clientSecret: string };
  }>('/sso/clients', { name: 'Grafana', redirectUris: [REDIRECT_URI] });
  expect(registered.status).toBe(201);
  clientId = registered.body.data.client.clientId;
  clientSecret = registered.body.data.clientSecret;

  const external = await root.client.post<{ data: { client: { clientId: string } } }>(
    '/sso/clients',
    { name: 'Partner Portal', redirectUris: [REDIRECT_URI], isExternal: true },
  );
  expect(external.status).toBe(201);
  externalClientId = external.body.data.client.clientId;
});

afterAll(async () => {
  await env.close();
});

const authorizationUrl = (codeChallenge: string, forClientId: string = clientId): string => {
  const query = new URLSearchParams({
    client_id: forClientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    state: 'state-1',
    nonce: 'nonce-1',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `/oidc/auth?${query.toString()}`;
};

describe('OIDC authorization code flow', () => {
  it('sends a browser without a Compass session to /login and keeps the way back', async () => {
    const browser = new Browser(() => null);

    const authorize = await browser.get(authorizationUrl('x'.repeat(43)), { withCompass: false });
    expect(authorize.statusCode, authorize.body).toBe(303);
    const interactionPath = locationPath(authorize.headers['location']);
    expect(interactionPath).toMatch(/^\/oidc\/interaction\//);

    const interaction = await browser.get(interactionPath, { withCompass: false });
    expect(interaction.statusCode).toBe(302);
    expect(interaction.headers['location']).toBe(
      `/login?returnTo=${encodeURIComponent(interactionPath)}`,
    );
  });

  it('issues a signed id token whose auth_time, acr and amr come from the Compass session', async () => {
    const browser = new Browser(() => root.client.cookie);
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());

    const authorize = await browser.get(authorizationUrl(challenge), { withCompass: false });
    const interactionPath = locationPath(authorize.headers['location']);

    // Login: la sesión de Compass se traduce a la identidad del proveedor.
    const login = await browser.get(interactionPath, { withCompass: true });
    expect(login.statusCode).toBe(303);
    // Consentimiento: el cliente es interno, se concede sin preguntar.
    const consentStep = await browser.get(locationPath(login.headers['location']), {
      withCompass: true,
    });
    expect(consentStep.statusCode).toBe(303);
    const consent = await browser.get(locationPath(consentStep.headers['location']), {
      withCompass: true,
    });
    expect(consent.statusCode).toBe(303);
    const resume = await browser.get(locationPath(consent.headers['location']), {
      withCompass: true,
    });
    expect(resume.statusCode).toBe(303);
    const callback = new URL(String(resume.headers['location']));
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('state-1');
    const code = callback.searchParams.get('code');
    expect(code).not.toBeNull();

    const token = await env.app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });
    expect(token.statusCode, token.body).toBe(200);
    const body = token.json<{ id_token: string; access_token: string; token_type: string }>();
    expect(body.token_type).toBe('Bearer');

    const jwt = decodeJwt(body.id_token);
    expect(jwt.header['alg']).toBe('ES256');
    expect(jwt.payload).toMatchObject({
      sub: rootUserId,
      aud: clientId,
      iss: 'http://app.test',
      nonce: 'nonce-1',
      acr: 'urn:compass:acr:mfa',
      amr: ['mfa'],
    });
    expect(typeof jwt.payload['auth_time']).toBe('number');

    // La firma se comprueba contra el JWKS público que publica el proveedor.
    const jwks = (await env.app.inject({ method: 'GET', url: '/oidc/jwks' })).json<{
      keys: (Record<string, unknown> & { kid: string })[];
    }>();
    const publicJwk = jwks.keys.find((key) => key.kid === jwt.header['kid']);
    expect(publicJwk).toBeDefined();
    const valid = verify(
      'sha256',
      Buffer.from(jwt.signingInput),
      {
        key: createPublicKey({ key: publicJwk as never, format: 'jwk' }),
        dsaEncoding: 'ieee-p1363',
      },
      jwt.signature,
    );
    expect(valid).toBe(true);
    expect(JSON.stringify(jwks)).not.toContain('"d"');
  });

  it('refuses the code a second time (single use)', async () => {
    const browser = new Browser(() => root.client.cookie);
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const authorize = await browser.get(authorizationUrl(challenge), { withCompass: false });
    const login = await browser.get(locationPath(authorize.headers['location']), {
      withCompass: true,
    });
    const consentStep = await browser.get(locationPath(login.headers['location']), {
      withCompass: true,
    });
    const consent = await browser.get(locationPath(consentStep.headers['location']), {
      withCompass: true,
    });
    const resume = await browser.get(locationPath(consent.headers['location']), {
      withCompass: true,
    });
    const code = new URL(String(resume.headers['location'])).searchParams.get('code') ?? '';

    const exchange = () =>
      env.app.inject({
        method: 'POST',
        url: '/oidc/token',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }).toString(),
      });

    const first = await exchange();
    expect(first.statusCode, first.body).toBe(200);
    expect((await exchange()).statusCode).toBe(400);
  });
});

describe('OIDC consent screen for external clients', () => {
  /** Recorre autorización y login hasta que el proveedor manda a la pantalla de consentimiento. */
  const reachConsent = async (browser: Browser) => {
    const authorize = await browser.get(authorizationUrl('x'.repeat(43), externalClientId), {
      withCompass: false,
    });
    const login = await browser.get(locationPath(authorize.headers['location']), {
      withCompass: true,
    });
    const consentStep = await browser.get(locationPath(login.headers['location']), {
      withCompass: true,
    });
    const prompt = await browser.get(locationPath(consentStep.headers['location']), {
      withCompass: true,
    });
    expect(prompt.statusCode).toBe(302);
    const target = new URL(locationPath(prompt.headers['location']), 'http://app.test');
    expect(target.pathname).toBe('/sso/consent');
    const uid = target.searchParams.get('uid') ?? '';
    return { uid, consentPath: `/oidc/interaction/${uid}/consent` };
  };

  it('describes the request, and allow ends with an authorization code', async () => {
    const browser = new Browser(() => root.client.cookie);
    const { consentPath } = await reachConsent(browser);

    const description = await browser.get(consentPath, { withCompass: true });
    expect(description.statusCode, description.body).toBe(200);
    expect(description.headers['cache-control']).toBe('no-store');
    expect(description.json<{ clientName: string; scopes: string[] }>()).toEqual({
      clientName: 'Partner Portal',
      scopes: expect.arrayContaining(['openid']) as string[],
    });

    const allow = await browser.post(`${consentPath}/allow`, {
      withCompass: true,
      origin: 'http://app.test',
    });
    expect(allow.statusCode, allow.body).toBe(303);
    const resume = await browser.get(locationPath(allow.headers['location']), {
      withCompass: true,
    });
    expect(resume.statusCode).toBe(303);
    const callback = new URL(String(resume.headers['location']));
    expect(callback.searchParams.get('code')).not.toBeNull();
  });

  it('deny returns access_denied to the client without a code', async () => {
    const browser = new Browser(() => root.client.cookie);
    const { consentPath } = await reachConsent(browser);

    const deny = await browser.post(`${consentPath}/deny`, {
      withCompass: true,
      origin: 'http://app.test',
    });
    expect(deny.statusCode, deny.body).toBe(303);
    const resume = await browser.get(locationPath(deny.headers['location']), {
      withCompass: true,
    });
    const callback = new URL(String(resume.headers['location']));
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('code')).toBeNull();
  });

  it('refuses a decision from a foreign origin or without the Compass session', async () => {
    const browser = new Browser(() => root.client.cookie);
    const { consentPath } = await reachConsent(browser);

    const foreign = await browser.post(`${consentPath}/allow`, {
      withCompass: true,
      origin: 'http://evil.test',
    });
    const anonymous = await browser.post(`${consentPath}/allow`, {
      withCompass: false,
      origin: 'http://app.test',
    });

    expect(foreign.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(400);
  });
});

describe('OIDC revocation cascade', () => {
  it('closing the Compass session makes an issued authorization code unusable (ADR 0051 §3)', async () => {
    const browser = new Browser(() => root.client.cookie);
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const authorize = await browser.get(authorizationUrl(challenge), { withCompass: false });
    const login = await browser.get(locationPath(authorize.headers['location']), {
      withCompass: true,
    });
    const consentStep = await browser.get(locationPath(login.headers['location']), {
      withCompass: true,
    });
    const consent = await browser.get(locationPath(consentStep.headers['location']), {
      withCompass: true,
    });
    const resume = await browser.get(locationPath(consent.headers['location']), {
      withCompass: true,
    });
    const code = new URL(String(resume.headers['location'])).searchParams.get('code') ?? '';
    expect(code).not.toBe('');

    const rowsFor = async (): Promise<number> => {
      const result = await env.adminPool.query<{ n: string }>(
        `select count(*) as n from oidc_payloads where user_id = $1`,
        [rootUserId],
      );
      return Number(result.rows[0]?.n ?? '0');
    };
    expect(await rowsFor()).toBeGreaterThan(0);

    // Es la última prueba del archivo: cerrar la sesión de la Raíz no afecta a las anteriores.
    expect((await root.client.post('/auth/logout', {})).status).toBe(204);

    // La cascada borra las filas de verdad (no basta con que ya no valgan) y deja rastro auditado.
    expect(await rowsFor()).toBe(0);
    const audited = await env.adminPool.query<{ n: string }>(
      `select count(*) as n from audit_events where action = 'oidc.grants_revoked'`,
    );
    expect(Number(audited.rows[0]?.n)).toBeGreaterThan(0);

    // Y deja encolado el aviso de logout a la aplicación, con solo identificadores (nunca el token firmado).
    const queued = await env.adminPool.query<{ payload: Record<string, unknown> }>(
      `select payload from outbox_events where type = 'oidc.backchannel_logout'`,
    );
    expect(queued.rows.length).toBeGreaterThan(0);
    for (const row of queued.rows) {
      expect(Object.keys(row.payload).sort()).toEqual(['clientId', 'sid']);
    }
    expect(queued.rows.some((row) => row.payload['clientId'] === clientId)).toBe(true);

    const exchange = await env.app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });
    expect(exchange.statusCode, exchange.body).toBe(400);
  });
});
