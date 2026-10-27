import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, NETWORK_ERROR_CODE } from './api-error';
import { createApiClient } from './client';

const schema = z.object({ ok: z.boolean() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** `response` se evalúa en cada llamada: un Response solo se puede leer una vez. */
function setup(response: Response | { reject: unknown }) {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    response instanceof Response
      ? Promise.resolve(response.clone())
      : // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- DOMException no es Error en jsdom
        Promise.reject(response.reject),
  );
  return { fetchImpl, client: createApiClient({ baseUrl: '/api/v1', fetchImpl }) };
}

function lastCall(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [url, init] = fetchImpl.mock.calls.at(-1) ?? [];
  return { url: typeof url === 'string' ? url : '', init, headers: new Headers(init?.headers) };
}

describe('api client request headers', () => {
  it('does not add mutation headers to GET and builds the query string', async () => {
    const { client, fetchImpl } = setup(jsonResponse({ ok: true }));
    await client.get('/things', schema, { query: { limit: 25, q: undefined, sort: 'name' } });
    const { url, headers, init } = lastCall(fetchImpl);
    expect(url).toBe('/api/v1/things?limit=25&sort=name');
    expect(headers.has('X-Requested-With')).toBe(false);
    expect(headers.has('Idempotency-Key')).toBe(false);
    expect(init?.credentials).toBe('same-origin');
  });

  it('adds X-Requested-With and a generated Idempotency-Key on POST', async () => {
    const { client, fetchImpl } = setup(jsonResponse({ ok: true }));
    await client.post('/things', schema, { body: { a: 1 } });
    const { headers, init } = lastCall(fetchImpl);
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');
  });

  it('reuses a caller-provided Idempotency-Key so retries stay idempotent', async () => {
    const { client, fetchImpl } = setup(jsonResponse({ ok: true }));
    await client.post('/things', schema, { idempotencyKey: 'fixed-key' });
    await client.post('/things', schema, { idempotencyKey: 'fixed-key' });
    expect(
      fetchImpl.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key')),
    ).toEqual(['fixed-key', 'fixed-key']);
  });

  it('adds X-Requested-With and If-Match on PATCH, without Idempotency-Key', async () => {
    const { client, fetchImpl } = setup(jsonResponse({ ok: true }));
    await client.patch('/things/1', schema, { body: {}, ifMatch: '"3"' });
    const { headers } = lastCall(fetchImpl);
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(headers.get('If-Match')).toBe('"3"');
    expect(headers.has('Idempotency-Key')).toBe(false);
  });

  it('adds X-Requested-With on DELETE', async () => {
    const { client, fetchImpl } = setup(jsonResponse({ ok: true }));
    await client.delete('/things/1', schema);
    expect(lastCall(fetchImpl).headers.get('X-Requested-With')).toBe('XMLHttpRequest');
  });
});

describe('api client errors', () => {
  const problem = {
    type: 'https://errors.internal/authz/hierarchy',
    title: 'Not allowed to manage this user',
    status: 403,
    code: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
    requestId: '01J0000000000000000000000',
  };

  it('turns Problem Details into a typed ApiError', async () => {
    const { client } = setup(jsonResponse(problem, 403));
    const error = await client.get('/x', schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
      requestId: '01J0000000000000000000000',
    });
  });

  it('keeps field errors of a 422', async () => {
    const body = {
      ...problem,
      status: 422,
      code: 'VALIDATION.FAILED',
      errors: [{ field: 'name', code: 'required' }],
    };
    const { client } = setup(jsonResponse(body, 422));
    const error = await client.post('/x', schema).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'name', code: 'required' }],
    });
  });

  it.each([
    [401, 'AUTHZ.SESSION'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT.VERSION'],
    [429, 'RATE_LIMITED'],
    [502, 'INTERNAL'],
  ])(
    'maps a %i with a non Problem Details body to %s without leaking the body',
    async (status, code) => {
      const { client } = setup(new Response('<html>secret stack trace</html>', { status }));
      const error = await client.get('/x', schema).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code, message: `HTTP ${String(status)}` });
    },
  );

  it('maps a network failure to the local NETWORK code', async () => {
    const { client } = setup({ reject: new TypeError('Failed to fetch') });
    const error = await client.get('/x', schema).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: NETWORK_ERROR_CODE });
  });

  it('rethrows aborts untouched', async () => {
    const { client } = setup({ reject: new DOMException('Aborted', 'AbortError') });
    await expect(client.get('/x', schema)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('treats a response that breaks the contract as an internal error', async () => {
    const { client } = setup(jsonResponse({ unexpected: true }));
    await expect(client.get('/x', schema)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
