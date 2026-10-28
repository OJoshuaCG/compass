import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IDEMPOTENT } from '../../../shared/http/http-decorators.js';
import { asOrganizationId, asUserId, DomainError } from '../../../shared/kernel/index.js';
import type {
  IdempotencyCall,
  IdempotencyDecision,
  IdempotencyService,
} from '../application/idempotency-service.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

const HTTP_CODE_METADATA = '__httpCode__';
const KEY = 'key-0001-abcdef';
const RESERVED_UNTIL = new Date('2026-01-15T10:01:00.000Z');

interface FakeRequest {
  principal?: { organizationId: ReturnType<typeof asOrganizationId>; userId: string } | undefined;
  id: string;
  headers: Record<string, string | undefined>;
  method: string;
  url: string;
  body: unknown;
}

interface SetupOptions {
  readonly idempotent?: boolean;
  readonly httpCode?: number;
  readonly request?: Partial<FakeRequest>;
  readonly decision?: IdempotencyDecision;
}

function setup(options: SetupOptions = {}) {
  const handler = (): void => undefined;
  const metadata = new Map<string, unknown>();
  if (options.idempotent ?? true) metadata.set(IDEMPOTENT, true);
  if (options.httpCode !== undefined) metadata.set(HTTP_CODE_METADATA, options.httpCode);
  const reflector = {
    get: (key: string, target: unknown) => (target === handler ? metadata.get(key) : undefined),
  } as unknown as Reflector;

  const parseKey = vi.fn((header: string | string[] | undefined): string => {
    if (typeof header !== 'string') {
      throw new DomainError('IDEMPOTENCY.KEY_REQUIRED', 'A valid Idempotency-Key is required');
    }
    return header;
  });
  // Las firmas van como genérico: así los espías registran los argumentos sin parámetros sin usar.
  const fingerprint = vi.fn<(method: string, path: string, body: unknown) => string>(
    () => 'request-hash',
  );
  const begin = vi.fn<(call: IdempotencyCall, hash: string) => Promise<IdempotencyDecision>>(() =>
    Promise.resolve(options.decision ?? { kind: 'proceed', reservedUntil: RESERVED_UNTIL }),
  );
  const complete = vi.fn<
    (call: IdempotencyCall, reservedUntil: Date, status: number, body: unknown) => Promise<void>
  >(() => Promise.resolve());
  const release = vi.fn<(call: IdempotencyCall, reservedUntil: Date) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const service = {
    parseKey,
    fingerprint,
    begin,
    complete,
    release,
  } as unknown as IdempotencyService;

  const request: FakeRequest = {
    principal: { organizationId: asOrganizationId('org-1'), userId: asUserId('user-1') },
    id: 'req-1',
    headers: { 'idempotency-key': KEY },
    method: 'POST',
    url: '/users?invite=1',
    body: { email: 'ana@org.test' },
    ...options.request,
  };
  const responseHeaders: Record<string, string> = {};
  const response = {
    header: (name: string, value: string): void => {
      responseHeaders[name] = value;
    },
  };
  const context = {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;

  const interceptor = new IdempotencyInterceptor(reflector, service);
  return {
    interceptor,
    context,
    responseHeaders,
    parseKey,
    fingerprint,
    begin,
    complete,
    release,
  };
}

function handlerReturning(value: unknown): { next: CallHandler; calls: () => number } {
  let calls = 0;
  const next: CallHandler = {
    handle: () => {
      calls += 1;
      return of(value);
    },
  };
  return { next, calls: () => calls };
}

function handlerFailingWith(error: unknown): { next: CallHandler; calls: () => number } {
  let calls = 0;
  const next: CallHandler = {
    handle: () => {
      calls += 1;
      return throwError(() => error);
    },
  };
  return { next, calls: () => calls };
}

describe('IdempotencyInterceptor', () => {
  it('lets a route that is not marked @Idempotent() go through untouched', async () => {
    const { interceptor, context, begin, parseKey } = setup({ idempotent: false });
    const { next, calls } = handlerReturning({ ok: true });

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ ok: true });
    expect(calls()).toBe(1);
    expect(parseKey).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it('rejects a request without an authenticated principal before touching the store', async () => {
    const { interceptor, context, begin } = setup({ request: { principal: undefined } });
    const { next, calls } = handlerReturning({ ok: true });

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toMatchObject({
      code: 'AUTHZ.SESSION',
    });

    expect(calls()).toBe(0);
    expect(begin).not.toHaveBeenCalled();
  });

  it('rejects a request without a valid Idempotency-Key and never runs the handler', async () => {
    const { interceptor, context, begin } = setup({ request: { headers: {} } });
    const { next, calls } = handlerReturning({ ok: true });

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toMatchObject({
      code: 'IDEMPOTENCY.KEY_REQUIRED',
    });

    expect(calls()).toBe(0);
    expect(begin).not.toHaveBeenCalled();
  });

  it('identifies the call by the principal, the request id and the key', async () => {
    const { interceptor, context, begin } = setup();
    const { next } = handlerReturning({ id: 'user-9' });

    await lastValueFrom(interceptor.intercept(context, next));

    expect(begin).toHaveBeenCalledWith(
      {
        organizationId: asOrganizationId('org-1'),
        actorId: asUserId('user-1'),
        requestId: 'req-1',
        key: KEY,
      },
      'request-hash',
    );
  });

  it('fingerprints the method, the path without the query string and the body', async () => {
    const { interceptor, context, fingerprint } = setup();
    const { next } = handlerReturning({ id: 'user-9' });

    await lastValueFrom(interceptor.intercept(context, next));

    expect(fingerprint).toHaveBeenCalledWith('POST', '/users', { email: 'ana@org.test' });
  });

  it('runs the handler once and stores its response with the default POST status', async () => {
    const { interceptor, context, complete, release } = setup();
    const { next, calls } = handlerReturning({ id: 'user-9' });

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ id: 'user-9' });
    expect(calls()).toBe(1);
    expect(complete).toHaveBeenCalledWith(expect.anything(), RESERVED_UNTIL, 201, {
      id: 'user-9',
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('stores the status declared with @HttpCode() instead of the default', async () => {
    const { interceptor, context, complete } = setup({ httpCode: 200 });
    const { next } = handlerReturning({ id: 'user-9' });

    await lastValueFrom(interceptor.intercept(context, next));

    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      RESERVED_UNTIL,
      200,
      expect.anything(),
    );
  });

  it('replays the stored body, marks the response and never runs the handler again', async () => {
    const { interceptor, context, responseHeaders, complete, release } = setup({
      decision: { kind: 'replay', statusCode: 201, body: { id: 'user-9' } },
    });
    const { next, calls } = handlerReturning({ id: 'must-not-run' });

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ id: 'user-9' });
    expect(responseHeaders['idempotent-replayed']).toBe('true');
    expect(calls()).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('does not mark a first execution as a replay', async () => {
    const { interceptor, context, responseHeaders } = setup();
    const { next } = handlerReturning({ id: 'user-9' });

    await lastValueFrom(interceptor.intercept(context, next));

    expect(responseHeaders['idempotent-replayed']).toBeUndefined();
  });

  it('propagates the rejection of begin without running the handler', async () => {
    const { interceptor, context, begin } = setup();
    begin.mockRejectedValueOnce(new DomainError('IDEMPOTENCY.IN_PROGRESS', 'in progress'));
    const { next, calls } = handlerReturning({ ok: true });

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toMatchObject({
      code: 'IDEMPOTENCY.IN_PROGRESS',
    });

    expect(calls()).toBe(0);
  });

  it('releases the key and rethrows the original error when the handler fails', async () => {
    const { interceptor, context, complete, release } = setup();
    const failure = new DomainError('VALIDATION.FAILED', 'invalid');
    const { next } = handlerFailingWith(failure);

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toBe(failure);

    expect(release).toHaveBeenCalledWith(expect.anything(), RESERVED_UNTIL);
    expect(complete).not.toHaveBeenCalled();
  });

  it('still rethrows the handler error when releasing the key also fails', async () => {
    const { interceptor, context, release } = setup();
    release.mockRejectedValueOnce(new Error('database down'));
    const failure = new DomainError('VALIDATION.FAILED', 'invalid');
    const { next } = handlerFailingWith(failure);

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toBe(failure);
  });

  it('returns the response and does not release the key when storing it fails', async () => {
    const { interceptor, context, complete, release } = setup();
    complete.mockRejectedValueOnce(new Error('database down'));
    const { next } = handlerReturning({ id: 'user-9' });

    const result = await lastValueFrom(interceptor.intercept(context, next));

    // Liberar aquí permitiría crear el recurso otra vez: el caso de uso ya confirmó.
    expect(result).toEqual({ id: 'user-9' });
    expect(release).not.toHaveBeenCalled();
  });

  it('returns the response when the store refuses a response that carries secrets', async () => {
    const { interceptor, context, complete } = setup();
    complete.mockRejectedValueOnce(new Error('An idempotent response must not carry secrets'));
    const { next } = handlerReturning({ password: 'plain' });

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ password: 'plain' });
  });
});
