/**
 * Normalización mínima de direcciones de correo para compararlas por igualdad exacta.
 *
 * Reglas (todas fallan cerradas: ante la duda la dirección es inválida y no coincide con nada):
 * - Solo ASCII visible: sin espacios, controles ni Unicode. Una dirección con caracteres confundibles
 *   (por ejemplo una `а` cirílica) o con nombre visible (`"x" <a@b.com>`) no se normaliza.
 * - Sin caracteres de sintaxis de cabecera (`<>(),;:"[]\`): se espera la dirección ya extraída.
 * - Exactamente una `@`, con parte local y dominio no vacíos y un dominio sin puntos al borde ni dobles.
 * - Se bajan a minúsculas solo `A-Z` de toda la dirección (ver `ascii-text.ts`); no hay plegado Unicode,
 *   no se quitan puntos ni sufijos `+etiqueta`.
 * - No se aceptan dominios internacionales en forma Unicode; la forma `xn--` es ASCII y se compara
 *   literal, por lo que no iguala al dominio exacto de una plantilla.
 */
import { isVisibleAsciiOnly, toAsciiLowercase } from './ascii-text.js';
import { MAX_ADDRESS_LENGTH } from './inbound-limits.js';

const ADDRESS_SEPARATOR = '@';
const FORBIDDEN_ADDRESS_CHARACTERS = '<>(),;:"[]\\';

export interface NormalizedAddress {
  readonly address: string;
  readonly localPart: string;
  readonly domain: string;
}

export function normalizeEmailAddress(rawAddress: string): NormalizedAddress | null {
  if (rawAddress.length === 0 || rawAddress.length > MAX_ADDRESS_LENGTH) return null;
  if (!isVisibleAsciiOnly(rawAddress)) return null;
  for (const forbiddenCharacter of FORBIDDEN_ADDRESS_CHARACTERS) {
    if (rawAddress.includes(forbiddenCharacter)) return null;
  }

  const separatorIndex = rawAddress.indexOf(ADDRESS_SEPARATOR);
  const hasExactlyOneSeparator = separatorIndex === rawAddress.lastIndexOf(ADDRESS_SEPARATOR);
  const hasLocalPart = separatorIndex > 0;
  const hasDomain = separatorIndex >= 0 && separatorIndex < rawAddress.length - 1;
  if (!hasExactlyOneSeparator || !hasLocalPart || !hasDomain) return null;

  const normalizedAddress = toAsciiLowercase(rawAddress);
  const localPart = normalizedAddress.slice(0, separatorIndex);
  const domain = normalizedAddress.slice(separatorIndex + 1);
  if (!isWellFormedDomain(domain)) return null;

  return { address: normalizedAddress, localPart, domain };
}

/** Dominio sin punto inicial o final y sin etiquetas vacías (`a..b`). */
export function isWellFormedDomain(domain: string): boolean {
  if (domain.length === 0) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  return !domain.includes('..');
}
