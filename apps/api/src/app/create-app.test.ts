import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../shared/infrastructure/logger.js';
import { createApp } from './create-app.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApp({ logger: createLogger({ level: 'silent' }) });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe('createApp', () => {
  it('serves liveness under /api/v1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('generates the request id on the server and ignores one sent by the client', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { 'x-request-id': 'attacker-controlled' },
    });

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(res.headers['x-request-id']).not.toBe('attacker-controlled');
  });

  it('sends a strict CSP without unsafe-inline or unsafe-eval and forbids framing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    const csp = String(res.headers['content-security-policy']);

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('answers an unknown route as RFC 9457 problem details with the request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/missing' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json<{ requestId: string }>().requestId).toBe(res.headers['x-request-id']);
  });
});
