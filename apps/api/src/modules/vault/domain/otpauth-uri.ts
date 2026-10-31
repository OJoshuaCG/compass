/**
 * Análisis y validación del URI `otpauth://` que se registra como segundo factor de una credencial.
 *
 * Invariantes de seguridad
 * - Solo se admite `totp`: un URI `hotp` se rechaza porque su contador no se puede sincronizar sin estado.
 * - La clave debe tener al menos 128 bits (26 caracteres Base32): una más corta se adivina con facilidad.
 * - Solo se guarda el URI normalizado; la clave nunca viaja en un error ni se registra.
 */
import type { TotpAlgorithm } from '@iam/contracts';

export type TotpDigits = 6 | 8;
export type TotpPeriodSeconds = 30 | 60;

export interface TotpParameters {
  readonly algorithm: TotpAlgorithm;
  readonly digits: TotpDigits;
  readonly periodSeconds: TotpPeriodSeconds;
}

export interface ParsedOtpauthUri extends TotpParameters {
  /** Clave en Base32, en mayúsculas y sin espacios ni relleno. */
  readonly secretBase32: string;
  /** URI reconstruido con los valores ya normalizados; es lo único que se cifra y se guarda. */
  readonly normalizedUri: string;
}

export type OtpauthUriProblem =
  | 'not_otpauth'
  | 'not_totp'
  | 'secret_missing'
  | 'secret_invalid'
  | 'secret_too_short'
  | 'algorithm_unsupported'
  | 'digits_unsupported'
  | 'period_unsupported';

export type OtpauthParseResult =
  | { readonly ok: true; readonly value: ParsedOtpauthUri }
  | { readonly ok: false; readonly problem: OtpauthUriProblem };

const OTPAUTH_SCHEME = 'otpauth:';
const BITS_PER_BASE32_CHARACTER = 5;
export const MIN_SECRET_BITS = 128;
const BASE32_ALPHABET = /^[A-Z2-7]+$/;

const DEFAULT_ALGORITHM: TotpAlgorithm = 'SHA1';
const DEFAULT_DIGITS: TotpDigits = 6;
const DEFAULT_PERIOD_SECONDS: TotpPeriodSeconds = 30;

const ALGORITHMS: readonly TotpAlgorithm[] = ['SHA1', 'SHA256', 'SHA512'];

const fail = (problem: OtpauthUriProblem): OtpauthParseResult => ({ ok: false, problem });

export function parseOtpauthUri(rawUri: string): OtpauthParseResult {
  let url: URL;
  try {
    url = new URL(rawUri.trim());
  } catch {
    return fail('not_otpauth');
  }
  if (url.protocol !== OTPAUTH_SCHEME) return fail('not_otpauth');
  // En `otpauth://totp/...` el tipo es el "host" del URI.
  if (url.hostname.toLowerCase() !== 'totp') return fail('not_totp');

  const rawSecret = url.searchParams.get('secret');
  if (rawSecret === null || rawSecret.trim() === '') return fail('secret_missing');
  const secretBase32 = rawSecret.replace(/[\s=]/g, '').toUpperCase();
  if (!BASE32_ALPHABET.test(secretBase32)) return fail('secret_invalid');
  if (secretBase32.length * BITS_PER_BASE32_CHARACTER < MIN_SECRET_BITS) {
    return fail('secret_too_short');
  }

  const rawAlgorithm = url.searchParams.get('algorithm');
  const algorithm = rawAlgorithm === null ? DEFAULT_ALGORITHM : rawAlgorithm.toUpperCase();
  if (!ALGORITHMS.includes(algorithm as TotpAlgorithm)) return fail('algorithm_unsupported');

  const rawDigits = url.searchParams.get('digits');
  const digits = rawDigits === null ? DEFAULT_DIGITS : Number(rawDigits);
  if (digits !== 6 && digits !== 8) return fail('digits_unsupported');

  const rawPeriod = url.searchParams.get('period');
  const periodSeconds = rawPeriod === null ? DEFAULT_PERIOD_SECONDS : Number(rawPeriod);
  if (periodSeconds !== 30 && periodSeconds !== 60) return fail('period_unsupported');

  const normalized = new URL(`${OTPAUTH_SCHEME}//totp/${url.pathname.replace(/^\//, '')}`);
  normalized.searchParams.set('secret', secretBase32);
  const issuer = url.searchParams.get('issuer');
  if (issuer !== null) normalized.searchParams.set('issuer', issuer);
  normalized.searchParams.set('algorithm', algorithm);
  normalized.searchParams.set('digits', String(digits));
  normalized.searchParams.set('period', String(periodSeconds));

  return {
    ok: true,
    value: {
      secretBase32,
      algorithm: algorithm as TotpAlgorithm,
      digits,
      periodSeconds,
      normalizedUri: normalized.toString(),
    },
  };
}
