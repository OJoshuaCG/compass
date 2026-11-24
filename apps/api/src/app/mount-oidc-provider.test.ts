import type { IncomingMessage, ServerResponse } from 'node:http';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../shared/infrastructure/logger.js';
import { createApp } from './create-app.js';
import type { OidcCallbackProvider, OidcInteractionRoute } from './mount-oidc-provider.js';

/** Proveedor de mentira: devuelve lo que recibió, para comprobar que Fastify no tocó el cuerpo. */
const echoProvider: OidcCallbackProvider = {
  callback: () => (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          method: request.method,
          url: request.url,
          contentType: request.headers['content-type'] ?? null,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
  },
};

/** Acciones de consentimiento que llegaron a la ruta de interacción. */
const consentActions: string[] = [];

/** Cookies de Compass con las que se reanudó una autorización. */
const resumeTokens: (string | undefined)[] = [];

/** Cookie con la que la ruta de mentira falla, para probar que el rechazo se atiende. */
const FAILING_SESSION_TOKEN = 'failing-token';

/** Ruta de interacción de mentira: devuelve el `uid` y la cookie de Compass que le llegaron. */
const echoInteraction: OidcInteractionRoute = {
  runUnderCompassSession: (sessionToken, _requestId, work) => {
    resumeTokens.push(sessionToken);
    if (sessionToken === FAILING_SESSION_TOKEN) return Promise.reject(new Error('boom'));
    work();
    return Promise.resolve();
  },
  handle: ({ response, uid, sessionToken }) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ uid, sessionToken: sessionToken ?? null }));
    return Promise.resolve();
  },
  handleConsent: ({ response, uid }, action) => {
    consentActions.push(`${uid}:${action}`);
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end('{}');
    return Promise.resolve();
  },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApp({
    logger: createLogger({ level: 'silent' }),
    oidcProvider: echoProvider,
    oidcInteraction: echoInteraction,
    appOrigin: 'http://app.test',
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe('mountOidcProvider', () => {
  it('serves /oidc/interaction/:uid with its own handler and the Compass session cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/oidc/interaction/abc123',
      cookies: { '__Host-session': 'compass-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ uid: string; sessionToken: string }>()).toEqual({
      uid: 'abc123',
      sessionToken: 'compass-token',
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('routes consent decisions only when the Origin is the application origin', async () => {
    consentActions.length = 0;
    const url = '/oidc/interaction/abc123/consent/allow';

    const foreign = await app.inject({
      method: 'POST',
      url,
      headers: { origin: 'http://evil.test' },
    });
    const missing = await app.inject({ method: 'POST', url });
    const own = await app.inject({ method: 'POST', url, headers: { origin: 'http://app.test' } });
    const describe = await app.inject({ method: 'GET', url: '/oidc/interaction/abc123/consent' });

    expect([foreign.statusCode, missing.statusCode, own.statusCode, describe.statusCode]).toEqual([
      403, 403, 200, 200,
    ]);
    expect(consentActions).toEqual(['abc123:allow', 'abc123:describe']);
  });

  it('resumes /oidc/auth/:uid under the Compass session and still delivers it to the provider', async () => {
    resumeTokens.length = 0;
    const response = await app.inject({
      method: 'GET',
      url: '/oidc/auth/abc123',
      cookies: { '__Host-session': 'compass-token' },
    });

    expect(resumeTokens).toEqual(['compass-token']);
    expect(response.json<{ url: string }>().url).toBe('/oidc/auth/abc123');
  });

  it('answers a generic 500 when resuming an authorization fails, without leaking the error', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/oidc/auth/abc123',
      cookies: { '__Host-session': FAILING_SESSION_TOKEN },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('Internal Server Error');
    expect(response.body).not.toContain('boom');
  });

  it('still delivers the rest of /oidc to the provider when interactions are mounted', async () => {
    const response = await app.inject({ method: 'GET', url: '/oidc/auth?client_id=x' });

    expect(response.json<{ url: string }>().url).toBe('/oidc/auth?client_id=x');
  });

  it('delivers the discovery document path to the provider', async () => {
    const response = await app.inject({ method: 'GET', url: '/.well-known/openid-configuration' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ url: string }>().url).toBe('/.well-known/openid-configuration');
  });

  it('hands the untouched form body of the token endpoint to the provider', async () => {
    const form = 'grant_type=authorization_code&code=abc&code_verifier=xyz';

    const response = await app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ body: string }>().body).toBe(form);
  });

  it('keeps the security headers of the project on delivered responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/oidc/jwks' });
    const csp = String(response.headers['content-security-policy']);

    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('does not route other paths to the provider and keeps the JSON parser of the API', async () => {
    const live = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    const other = await app.inject({ method: 'GET', url: '/oidc-not-a-route' });
    const badJson = await app.inject({
      method: 'POST',
      url: '/api/v1/health/live',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(live.json()).toEqual({ status: 'ok' });
    expect(other.statusCode).toBe(404);
    expect(badJson.statusCode).toBe(400);
  });
});
