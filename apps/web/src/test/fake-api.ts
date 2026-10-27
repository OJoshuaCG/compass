import type { MeResponse, Permission } from '@iam/contracts';
import { vi } from 'vitest';

export type RecordedCall = {
  method: string;
  /** Ruta sin el prefijo `/api/v1`. */
  path: string;
  search: URLSearchParams;
  body: unknown;
  headers: Headers;
};

type Handler = Response | ((call: RecordedCall) => Response | Promise<Response>);

export function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const noContent = () => new Response(null, { status: 204 });

/** Problem Details válido según el contrato (RFC 9457). */
export function problem(
  status: number,
  code: string,
  extra: { errors?: { field: string; code: string }[]; headers?: Record<string, string> } = {},
) {
  return jsonResponse(
    {
      type: `https://errors.example/${code}`,
      title: code,
      status,
      code,
      requestId: 'req-test-1',
      ...(extra.errors !== undefined ? { errors: extra.errors } : {}),
    },
    status,
    extra.headers,
  );
}

export function meFixture(
  overrides: { permissions?: Permission[]; rank?: 0 | 1 | 2 | 3; displayName?: string } = {},
): MeResponse {
  return {
    user: {
      id: '5c9e6f3e-4c1a-4a53-9d9e-6b0f0a1f7a01',
      email: 'ana@example.com',
      displayName: overrides.displayName ?? 'Ana Pérez',
      rank: overrides.rank ?? 1,
      locale: 'es-MX',
      timezone: 'America/Mexico_City',
    },
    permissions: overrides.permissions ?? [],
    session: { expiresAt: '2030-01-01T00:00:00.000Z', reauthUntil: null },
  };
}

/**
 * Sustituye `fetch` global (vi.stubGlobal) con rutas "METHOD /ruta". Registra cada llamada para
 * que la prueba verifique cuerpo, cabeceras y parámetros. Una ruta sin handler responde 404 y
 * queda en `unhandled`, para que la prueba falle de forma legible en vez de colgarse.
 */
export function stubApi(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const unhandled: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const call: RecordedCall = {
      method,
      path,
      search: url.searchParams,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) {
      unhandled.push(`${method} ${path}`);
      return problem(404, 'NOT_FOUND');
    }
    return typeof handler === 'function' ? handler(call) : handler.clone();
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    unhandled,
    callsTo: (method: string, path: string) =>
      calls.filter((call) => call.method === method && call.path === path),
  };
}
