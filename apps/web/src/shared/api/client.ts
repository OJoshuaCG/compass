import type { z } from 'zod';

import { ApiError } from './api-error';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type RequestOptions = {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Clave de idempotencia de un POST. El llamador la conserva entre reintentos de la misma
   * acción (por ejemplo en el estado del formulario); si no la da, se genera una nueva.
   */
  idempotencyKey?: string;
  /** Versión del recurso para `If-Match` (PATCH): detecta conflictos con 409. */
  ifMatch?: string;
};

export type ApiClient = {
  get: <S extends z.ZodType>(
    path: string,
    schema: S,
    options?: RequestOptions,
  ) => Promise<z.infer<S>>;
  post: <S extends z.ZodType>(
    path: string,
    schema: S,
    options?: RequestOptions,
  ) => Promise<z.infer<S>>;
  patch: <S extends z.ZodType>(
    path: string,
    schema: S,
    options?: RequestOptions,
  ) => Promise<z.infer<S>>;
  delete: <S extends z.ZodType>(
    path: string,
    schema: S,
    options?: RequestOptions,
  ) => Promise<z.infer<S>>;
};

const MUTATING: ReadonlySet<Method> = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${baseUrl}${path}${search === '' ? '' : `?${search}`}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Cliente HTTP base (docs/frontend.md §7.1): mismo origen, cookie de sesión (sin tokens en
 * JS), `X-Requested-With` en peticiones que modifican, `Idempotency-Key` en POST y
 * `If-Match` en PATCH. Toda respuesta no exitosa se convierte en `ApiError`. Las respuestas
 * exitosas se validan con el esquema Zod del contrato (el borde de red es `unknown`).
 */
export function createApiClient(
  config: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): ApiClient {
  const baseUrl = config.baseUrl ?? '/api/v1';
  const fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    options: RequestOptions = {},
  ): Promise<z.infer<S>> {
    const headers = new Headers({ Accept: 'application/json' });
    if (MUTATING.has(method)) headers.set('X-Requested-With', 'XMLHttpRequest');
    if (method === 'POST')
      headers.set('Idempotency-Key', options.idempotencyKey ?? crypto.randomUUID());
    if (method === 'PATCH' && options.ifMatch !== undefined)
      headers.set('If-Match', options.ifMatch);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, options.query), {
        method,
        headers,
        credentials: 'same-origin',
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      // Un aborto deliberado (cancelación de Query) no es un error de red: se propaga.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw ApiError.network();
    }

    const body = await readJson(response);
    if (!response.ok) throw ApiError.fromResponseBody(response.status, body);

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Contrato roto: se trata como error interno sin exponer el cuerpo.
      throw ApiError.fromResponseBody(500, undefined);
    }
    return parsed.data;
  }

  return {
    get: (path, schema, options) => request('GET', path, schema, options),
    post: (path, schema, options) => request('POST', path, schema, options),
    patch: (path, schema, options) => request('PATCH', path, schema, options),
    delete: (path, schema, options) => request('DELETE', path, schema, options),
  };
}

/** Instancia por defecto de la app. */
export const apiClient: ApiClient = createApiClient();
