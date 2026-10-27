import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../shared/infrastructure/logger.js';
import { createApp } from './create-app.js';

let app: NestFastifyApplication;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'iam-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>SPA</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, '..', 'iam-secret-outside.txt'), 'TOP-SECRET');
  app = await createApp({ logger: createLogger({ level: 'silent' }), webDistDir: dir });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(dir, '..', 'iam-secret-outside.txt'), { force: true });
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('cache policy does not depend on where the web folder lives', () => {
  it('keeps index.html uncached even when an ancestor directory is called "assets"', async () => {
    const base = mkdtempSync(join(tmpdir(), 'iam-ancestor-'));
    const nested = join(base, 'assets', 'web', 'dist');
    mkdirSync(join(nested, 'assets'), { recursive: true });
    writeFileSync(join(nested, 'index.html'), '<!doctype html><title>SPA</title>');
    writeFileSync(join(nested, 'assets', 'app-1.js'), 'console.log(1)');
    const other = await createApp({
      logger: createLogger({ level: 'silent' }),
      webDistDir: nested,
    });
    await other.init();
    await other.getHttpAdapter().getInstance().ready();
    try {
      const index = await other.inject({ method: 'GET', url: '/' });
      const fallback = await other.inject({ method: 'GET', url: '/login' });
      const asset = await other.inject({ method: 'GET', url: '/assets/app-1.js' });
      expect(index.headers['cache-control']).toBe('no-cache');
      expect(fallback.headers['cache-control']).toBe('no-cache');
      expect(asset.headers['cache-control']).toContain('immutable');
    } finally {
      await other.close();
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('serving the web app from the API origin', () => {
  it('serves index.html at the root with the strict CSP and without caching', async () => {
    const res = await get('/');

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>SPA</title>');
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('answers client-side routes with index.html so the app can decide what to show', async () => {
    for (const path of ['/login', '/login/mfa', '/invitation', '/users']) {
      const res = await get(path);
      expect(res.statusCode, path).toBe(200);
      expect(res.body, path).toContain('<title>SPA</title>');
    }
  });

  it('serves hashed assets as immutable for a year', async () => {
    const res = await get('/assets/app-abc123.js');

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['cache-control']).toContain('max-age=31536000');
  });

  it('keeps the API untouched: health works and an unknown API path is a JSON problem, not HTML', async () => {
    expect((await get('/api/v1/health/live')).json()).toEqual({ status: 'ok' });

    // Ni `/api` a secas devuelve el HTML de la SPA.
    expect((await get('/api')).headers['content-type']).toContain('application/problem+json');

    const missing = await get('/api/v1/definitely-missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');
    expect(missing.json<{ code: string }>().code).toBe('NOT_FOUND');
  });

  it('never serves files outside the web folder (path traversal)', async () => {
    for (const path of [
      '/..%2fiam-secret-outside.txt',
      '/%2e%2e/iam-secret-outside.txt',
      '/assets/..%2f..%2fiam-secret-outside.txt',
    ]) {
      const res = await get(path);
      expect(res.body, path).not.toContain('TOP-SECRET');
    }
  });
});
