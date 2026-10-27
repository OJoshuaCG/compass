import { ErrorCode } from '@iam/contracts';
import type { z } from 'zod';

import { ApiError } from './api-error';
import { reauthCoordinator } from './reauth-coordinator';
import { emitSessionExpired } from './session-events';

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
  /**
   * No reintentar tras reautenticar. Lo usa la propia llamada de reautenticación, que no debe
   * dispararse a sí misma.
   */
  skipReauth?: boolean;
  /**
   * No avisar de sesión expirada ante un 401. Lo usan las consultas que ya traducen el 401
   * a un estado ("sin sesión", como `/me`) y redirigen por su cuenta.
   */
  suppressSessionExpiry?: boolean;
};

export type ApiClientConfig = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /**
   * Abre la reautenticación y resuelve `true` si el usuario la completó. Con `AUTHZ.REAUTH_REQUIRED`
   * el cliente espera a esto y reintenta la petición UNA vez (docs/frontend.md §7.2).
   */
  onReauthRequired?: () => Promise<boolean>;
  /** Se llama ante un 401 que indica sesión perdida (no ante credenciales o código erróneos). */
  onSessionExpired?: () => void;
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

/** 401 que forman parte de un flujo de credenciales: no significan "sesión expirada". */
const CREDENTIAL_FAILURES: ReadonlySet<string> = new Set([
  ErrorCode.AUTH_INVALID_CREDENTIALS,
  ErrorCode.AUTH_MFA_INVALID,
]);

/** `Retry-After` en segundos enteros; la forma con fecha HTTP se ignora (el servidor usa segundos). */
function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get('Retry-After');
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

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
export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const baseUrl = config.baseUrl ?? '/api/v1';
  const fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function attempt<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    options: RequestOptions,
    idempotencyKey: string,
  ): Promise<z.infer<S>> {
    const headers = new Headers({ Accept: 'application/json' });
    if (MUTATING.has(method)) headers.set('X-Requested-With', 'XMLHttpRequest');
    if (method === 'POST') headers.set('Idempotency-Key', idempotencyKey);
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
    if (!response.ok) {
      const error = ApiError.fromResponseBody(response.status, body, parseRetryAfter(response));
      if (
        response.status === 401 &&
        options.suppressSessionExpiry !== true &&
        !CREDENTIAL_FAILURES.has(error.code)
      ) {
        config.onSessionExpired?.();
      }
      throw error;
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Contrato roto: se trata como error interno sin exponer el cuerpo.
      throw ApiError.fromResponseBody(500, undefined);
    }
    return parsed.data;
  }

  async function request<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    options: RequestOptions = {},
  ): Promise<z.infer<S>> {
    // La clave se fija una vez: el reintento tras reautenticar es la MISMA operación y no
    // debe crear un segundo recurso si el primer intento llegó a procesarse.
    const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
    const { onReauthRequired } = config;
    try {
      return await attempt(method, path, schema, options, idempotencyKey);
    } catch (error) {
      const needsReauth =
        error instanceof ApiError &&
        error.status === 403 &&
        error.code === ErrorCode.AUTHZ_REAUTH_REQUIRED &&
        options.skipReauth !== true &&
        onReauthRequired !== undefined;
      if (!needsReauth) throw error;
      // Si el usuario cancela se propaga el error original; si reautentica, un único reintento:
      // un segundo REAUTH_REQUIRED se muestra como error en vez de abrir el diálogo en bucle.
      const reauthenticated = await onReauthRequired();
      if (!reauthenticated) throw error;
      return attempt(method, path, schema, options, idempotencyKey);
    }
  }

  return {
    get: (path, schema, options) => request('GET', path, schema, options),
    post: (path, schema, options) => request('POST', path, schema, options),
    patch: (path, schema, options) => request('PATCH', path, schema, options),
    delete: (path, schema, options) => request('DELETE', path, schema, options),
  };
}

/** Instancia por defecto de la app: conectada al diálogo de reautenticación y al aviso de sesión. */
export const apiClient: ApiClient = createApiClient({
  onReauthRequired: () => reauthCoordinator.request(),
  onSessionExpired: emitSessionExpired,
});
