/**
 * Reglas de un cliente OIDC (ADR 0052): quién es, a dónde puede redirigir y qué rango puede entrar.
 * Sin dependencias de framework ni de Node.
 */
import { DomainError, err } from '../../../shared/kernel/index.js';
import type { Result } from '../../../shared/kernel/index.js';

export type OidcClientStatus = 'active' | 'disabled';

/** Rango máximo que puede entrar por un cliente: 0 Raíz … 3 Operador (entra quien tiene ese rango o uno de mayor autoridad). */
export type ClientRank = 0 | 1 | 2 | 3;

export interface OidcClientRecord {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly postLogoutRedirectUris: readonly string[];
  readonly backchannelLogoutUri: string | null;
  readonly allowPrivateNetworkBackchannel: boolean;
  readonly allowRefreshTokens: boolean;
  readonly refreshJustification: string | null;
  readonly isExternal: boolean;
  readonly maxRank: ClientRank | null;
  readonly status: OidcClientStatus;
  readonly createdAt: Date;
}

export const MAX_CLIENT_NAME_LENGTH = 80;
export const MAX_URIS_PER_LIST = 10;
export const MAX_URI_LENGTH = 2048;
export const MIN_REFRESH_JUSTIFICATION_LENGTH = 10;
export const MAX_REFRESH_JUSTIFICATION_LENGTH = 500;

/** Nombres de host de bucle local: los únicos que aceptan `http` (desarrollo y aplicaciones nativas, RFC 8252). */
const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

export const normalizeClientName = (value: string): string | null => {
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_CLIENT_NAME_LENGTH ? name : null;
};

export const isClientRank = (value: unknown): value is ClientRank =>
  value === 0 || value === 1 || value === 2 || value === 3;

/**
 * Una URI de redirección válida es absoluta, sin fragmento ni credenciales, y se compara exacta (sin
 * comodines). Solo `https`; `http` únicamente hacia bucle local.
 */
export function normalizeRedirectUri(value: string): string | null {
  if (value.length === 0 || value.length > MAX_URI_LENGTH || value.includes('*')) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.hash !== '' || value.includes('#')) return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  const isLoopback = LOOPBACK_HOSTNAMES.includes(parsed.hostname);
  if (parsed.protocol === 'https:') return value;
  if (parsed.protocol === 'http:' && isLoopback) return value;
  return null;
}

export function normalizeUriList(values: readonly string[]): readonly string[] | null {
  if (values.length > MAX_URIS_PER_LIST) return null;
  const normalized: string[] = [];
  for (const value of values) {
    const uri = normalizeRedirectUri(value);
    if (uri === null) return null;
    if (!normalized.includes(uri)) normalized.push(uri);
  }
  return normalized;
}

export const normalizeRefreshJustification = (value: string): string | null => {
  const text = value.trim();
  return text.length >= MIN_REFRESH_JUSTIFICATION_LENGTH &&
    text.length <= MAX_REFRESH_JUSTIFICATION_LENGTH
    ? text
    : null;
};

export const invalidClientField = (field: string): Result<never, DomainError> =>
  err(new DomainError('VALIDATION.FAILED', `Invalid field: ${field}`, { field }));
