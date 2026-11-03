import { isIP } from 'node:net';

/**
 * Guardia anti-SSRF del sondeo IMAP (ADR 0045, paso 5). El host lo escribe un administrador de la
 * organización: sin esta guardia el worker, que está dentro de la red, podría sondear servicios internos
 * o los metadatos de la nube. Falla cerrado: una dirección que no se pueda clasificar se rechaza.
 */

export const HOST_GUARD_FAILURE_CODES = ['HOST_UNRESOLVED', 'HOST_NOT_ALLOWED'] as const;
export type HostGuardFailureCode = (typeof HOST_GUARD_FAILURE_CODES)[number];

export type HostGuardResult =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly code: HostGuardFailureCode };

/** Resuelve TODOS los registros A y AAAA de un nombre (no solo el primero). */
export type AddressResolver = (host: string) => Promise<readonly string[]>;

interface Range {
  readonly base: Uint8Array;
  readonly prefixLength: number;
}

const IPV4_BYTES = 4;
const IPV6_BYTES = 16;
const BITS_PER_BYTE = 8;
const IPV4_MAPPED_PREFIX_BYTES = 12;
const MAX_IPV6_GROUPS = 8;
const BYTES_PER_IPV6_GROUP = 2;
const MAX_IPV4_OCTET = 255;
const MAX_IPV6_GROUP_VALUE = 0xffff;
const HEX_BASE = 16;

function ipv4Range(address: string, prefixLength: number): Range {
  const parsed = parseIpv4(address);
  if (parsed === null) throw new Error(`Invalid IPv4 range ${address}`);
  return { base: parsed, prefixLength };
}

function ipv6Range(address: string, prefixLength: number): Range {
  const parsed = parseIpv6(address);
  if (parsed === null) throw new Error(`Invalid IPv6 range ${address}`);
  return { base: parsed, prefixLength };
}

/** IPv4 que nunca debe alcanzar el worker: privadas, locales, de documentación, multicast y reservadas. */
const BLOCKED_IPV4_RANGES: readonly Range[] = [
  ipv4Range('0.0.0.0', 8),
  ipv4Range('10.0.0.0', 8),
  ipv4Range('100.64.0.0', 10),
  ipv4Range('127.0.0.0', 8),
  ipv4Range('169.254.0.0', 16),
  ipv4Range('172.16.0.0', 12),
  ipv4Range('192.0.0.0', 24),
  ipv4Range('192.0.2.0', 24),
  ipv4Range('192.88.99.0', 24),
  ipv4Range('192.168.0.0', 16),
  ipv4Range('198.18.0.0', 15),
  ipv4Range('198.51.100.0', 24),
  ipv4Range('203.0.113.0', 24),
  ipv4Range('224.0.0.0', 4),
  ipv4Range('240.0.0.0', 4),
];

/**
 * Dentro del unicast global `2000::/3`, estos bloques se rechazan. NAT64 (`64:ff9b::/96`), `::/96`, ULA,
 * enlace local y multicast ya quedan fuera por no estar en `2000::/3`: no se repiten aquí.
 */
const BLOCKED_IPV6_RANGES: readonly Range[] = [
  // Asignaciones de protocolo de la IETF: Teredo (`2001::/32`), benchmarking, ORCHID y demás.
  ipv6Range('2001::', 23),
  ipv6Range('2001:db8::', 32),
  ipv6Range('2002::', 16),
  // Documentación (RFC 9637), también dentro del unicast global.
  ipv6Range('3fff::', 20),
];

const GLOBAL_UNICAST_IPV6 = ipv6Range('2000::', 3);
const IPV4_MAPPED_IPV6 = ipv6Range('::ffff:0:0', 96);

/** `null` si no es un IPv4 en notación de cuatro octetos decimales. */
function parseIpv4(address: string): Uint8Array | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split('.').map(Number);
  if (octets.length !== IPV4_BYTES) return null;
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > MAX_IPV4_OCTET)) {
    return null;
  }
  return Uint8Array.from(octets);
}

/** `null` si no es un IPv6 válido. Una zona (`%eth0`) no se admite: no tiene sentido para un host remoto. */
function parseIpv6(address: string): Uint8Array | null {
  if (address.includes('%') || isIP(address) !== 6) return null;

  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    // Cola IPv4 embebida (`::ffff:1.2.3.4`): se reemplaza por dos grupos hexadecimales.
    const embedded = parseIpv4(tail);
    if (embedded === null) return null;
    const high = ((embedded[0] ?? 0) << BITS_PER_BYTE) | (embedded[1] ?? 0);
    const low = ((embedded[2] ?? 0) << BITS_PER_BYTE) | (embedded[3] ?? 0);
    text = `${text.slice(0, lastColon + 1)}${high.toString(HEX_BASE)}:${low.toString(HEX_BASE)}`;
  }

  const [head, rest, ...extra] = text.split('::');
  if (extra.length > 0 || head === undefined) return null;
  const headGroups = head === '' ? [] : head.split(':');
  const restGroups = rest === undefined ? null : rest === '' ? [] : rest.split(':');

  let groups: string[];
  if (restGroups === null) {
    groups = headGroups;
  } else {
    const missing = MAX_IPV6_GROUPS - headGroups.length - restGroups.length;
    if (missing < 1) return null;
    groups = [...headGroups, ...Array.from({ length: missing }, () => '0'), ...restGroups];
  }
  if (groups.length !== MAX_IPV6_GROUPS) return null;

  const bytes = new Uint8Array(IPV6_BYTES);
  for (const [index, group] of groups.entries()) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, HEX_BASE);
    if (value > MAX_IPV6_GROUP_VALUE) return null;
    bytes[index * BYTES_PER_IPV6_GROUP] = value >> BITS_PER_BYTE;
    bytes[index * BYTES_PER_IPV6_GROUP + 1] = value & MAX_IPV4_OCTET;
  }
  return bytes;
}

/** Bytes de la dirección (4 o 16), o `null` si el texto no es una IP. */
export function parseIpAddress(address: string): Uint8Array | null {
  return parseIpv4(address) ?? parseIpv6(address);
}

function isInRange(address: Uint8Array, range: Range): boolean {
  if (address.length !== range.base.length) return false;
  let remainingBits = range.prefixLength;
  for (const [index, baseByte] of range.base.entries()) {
    if (remainingBits <= 0) return true;
    const bitsInThisByte = Math.min(remainingBits, BITS_PER_BYTE);
    const mask = (MAX_IPV4_OCTET << (BITS_PER_BYTE - bitsInThisByte)) & MAX_IPV4_OCTET;
    if (((address[index] ?? 0) & mask) !== (baseByte & mask)) return false;
    remainingBits -= BITS_PER_BYTE;
  }
  return true;
}

/** `true` solo si la dirección es de Internet público; cualquier otra cosa, o lo que no se entienda, es no. */
export function isPublicAddress(address: string): boolean {
  const bytes = parseIpAddress(address);
  if (bytes === null) return false;

  if (bytes.length === IPV4_BYTES) {
    return !BLOCKED_IPV4_RANGES.some((range) => isInRange(bytes, range));
  }
  // IPv4 mapeada en IPv6: se valida la IPv4 que contiene.
  if (isInRange(bytes, IPV4_MAPPED_IPV6)) {
    return isPublicAddress(bytes.slice(IPV4_MAPPED_PREFIX_BYTES).join('.'));
  }
  // Solo el unicast global; así quedan fuera `::`, `::1`, compatibles con IPv4, ULA, enlace local y multicast.
  if (!isInRange(bytes, GLOBAL_UNICAST_IPV6)) return false;
  return !BLOCKED_IPV6_RANGES.some((range) => isInRange(bytes, range));
}

/** Prefijos mínimos de una excepción: evita que un descuido en la variable de entorno abra todo. */
const MIN_ALLOWED_IPV4_PREFIX = 16;
const MIN_ALLOWED_IPV6_PREFIX = 48;

/** Nunca se admiten como excepción: loopback, metadatos de nube (enlace local), no especificada y multicast. */
const NEVER_ALLOWED_RANGES: readonly Range[] = [
  ipv4Range('0.0.0.0', 8),
  ipv4Range('127.0.0.0', 8),
  ipv4Range('169.254.0.0', 16),
  ipv4Range('224.0.0.0', 4),
  ipv4Range('240.0.0.0', 4),
  ipv6Range('::', 128),
  ipv6Range('::1', 128),
  ipv6Range('fe80::', 10),
  ipv6Range('ff00::', 8),
];

/**
 * Excepción del despliegue: una IP exacta o un bloque `ip/prefijo` que el worker sí puede alcanzar. Se
 * rechaza (queda sin efecto) un bloque demasiado amplio o que toque loopback, enlace local o multicast.
 */
export function parseAllowedNetwork(entry: string): Range | null {
  const [addressPart, prefixPart, ...extra] = entry.trim().split('/');
  if (addressPart === undefined || extra.length > 0) return null;
  const base = parseIpAddress(addressPart);
  if (base === null) return null;
  if (NEVER_ALLOWED_RANGES.some((range) => isInRange(base, range))) return null;
  const maxPrefix = base.length * BITS_PER_BYTE;
  if (prefixPart === undefined) return { base, prefixLength: maxPrefix };
  if (!/^\d{1,3}$/.test(prefixPart)) return null;
  const prefixLength = Number(prefixPart);
  const minPrefix = base.length === IPV4_BYTES ? MIN_ALLOWED_IPV4_PREFIX : MIN_ALLOWED_IPV6_PREFIX;
  if (prefixLength > maxPrefix || prefixLength < minPrefix) return null;
  return { base, prefixLength };
}

/** Una IPv4 mapeada en IPv6 (`::ffff:a.b.c.d`) se compara como la IPv4 que contiene. */
function unmapIpv4(bytes: Uint8Array): Uint8Array {
  return isInRange(bytes, IPV4_MAPPED_IPV6) ? bytes.slice(IPV4_MAPPED_PREFIX_BYTES) : bytes;
}

export class NetworkGuard {
  private readonly allowedNetworks: readonly Range[];

  /**
   * @param resolveAddresses resolución de nombres (inyectada para probarla sin red).
   * @param allowedPrivateNetworks excepciones del despliegue (variable de entorno del worker, nunca de la
   *   API); una entrada ilegible se ignora y por tanto no abre nada.
   */
  constructor(
    private readonly resolveAddresses: AddressResolver,
    allowedPrivateNetworks: readonly string[] = [],
  ) {
    this.allowedNetworks = allowedPrivateNetworks
      .map(parseAllowedNetwork)
      .filter((range): range is Range => range !== null);
  }

  /**
   * Resuelve el nombre una sola vez y valida TODOS sus registros. Devuelve la IP a la que conectar (el
   * llamador conserva el nombre para verificar el certificado), lo que cubre el rebinding de DNS entre
   * pasadas. Un solo registro no permitido rechaza el nombre entero.
   */
  async resolve(host: string): Promise<HostGuardResult> {
    let addresses: readonly string[];
    if (parseIpAddress(host) !== null) {
      addresses = [host];
    } else {
      try {
        addresses = await this.resolveAddresses(host);
      } catch {
        return { ok: false, code: 'HOST_UNRESOLVED' };
      }
    }

    const [firstAddress] = addresses;
    if (firstAddress === undefined) return { ok: false, code: 'HOST_UNRESOLVED' };
    if (!addresses.every((address) => this.isAllowed(address))) {
      return { ok: false, code: 'HOST_NOT_ALLOWED' };
    }
    return { ok: true, address: firstAddress };
  }

  private isAllowed(address: string): boolean {
    if (isPublicAddress(address)) return true;
    const parsed = parseIpAddress(address);
    if (parsed === null) return false;
    const bytes = unmapIpv4(parsed);
    return this.allowedNetworks.some((range) => isInRange(bytes, range));
  }
}
