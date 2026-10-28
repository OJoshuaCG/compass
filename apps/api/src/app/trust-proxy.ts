import { isIP } from 'node:net';

/**
 * Qué saltos de `X-Forwarded-For` se toman como confiables (opción `trustProxy` de Fastify):
 * `false` ninguno, `true` toda la cadena, un número los últimos N saltos, y una lista las
 * direcciones o rangos CIDR de los proxies conocidos.
 */
export type TrustProxySetting = boolean | number | readonly string[];

/** Más saltos que esto no es una topología real: es casi seguro un error al escribir el valor. */
const MAX_TRUSTED_HOPS = 10;

const MAX_PREFIX_BY_IP_VERSION: Readonly<Record<number, number>> = { 4: 32, 6: 128 };

/**
 * Prefijo mínimo aceptado por familia. Un rango más amplio (por ejemplo `0.0.0.0/1`) confía en
 * media Internet y es casi seguro un error al escribirlo; un balanceador real vive en un rango
 * privado o en la red del proveedor, siempre más estrecho.
 */
const MIN_PREFIX_BY_IP_VERSION: Readonly<Record<number, number>> = { 4: 8, 6: 16 };

/**
 * Una dirección IPv4 mapeada en IPv6 (`::ffff:a.b.c.d`) usa los primeros 96 bits como relleno:
 * con un prefijo menor a 104 el rango abarcaría toda una clase A de IPv4, y con `/96` todo IPv4.
 */
const IPV4_MAPPED_PREFIX = '::ffff:';
const MIN_PREFIX_FOR_IPV4_MAPPED = 104;

const DIGITS_ONLY = /^\d+$/;

function isTrustedAddressOrRange(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/');
  if (address === undefined || rest.length > 0) {
    return false;
  }
  const ipVersion = isIP(address);
  if (ipVersion === 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  const maxPrefix = MAX_PREFIX_BY_IP_VERSION[ipVersion];
  let minPrefix = MIN_PREFIX_BY_IP_VERSION[ipVersion];
  if (!DIGITS_ONLY.test(prefix) || maxPrefix === undefined || minPrefix === undefined) {
    return false;
  }
  if (ipVersion === 6 && address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)) {
    minPrefix = MIN_PREFIX_FOR_IPV4_MAPPED;
  }
  const prefixLength = Number(prefix);
  // Un prefijo 0 (0.0.0.0/0, ::/0) confía en cualquier origen: equivale a `true` y anula la lista.
  return prefixLength >= minPrefix && prefixLength <= maxPrefix;
}

/** Forma que acepta la opción `trustProxy` del adaptador de Fastify. */
export type FastifyTrustProxy = boolean | string[] | ((address: string, hop: number) => boolean);

/**
 * Convierte el ajuste a lo que Fastify acepta. Un número de saltos se expresa como función
 * (salto 0 es el par directo): es lo que `proxy-addr` hace con un número, pero el tipo del
 * adaptador no lo admite. Los arreglos se copian porque Fastify no acepta uno de solo lectura.
 *
 * Limitación conocida: Fastify 5 trata un número plano como "no confiar en nadie" porque los
 * saltos no validan la dirección del par directo. Esta función sí confía en él, así que quien
 * llegue directo a la API puede falsear su IP con la cabecera. Solo es seguro si la API es
 * inalcanzable sin pasar por el proxy; la lista de IP o CIDR no tiene esa dependencia.
 */
export function toFastifyTrustProxy(setting: TrustProxySetting | undefined): FastifyTrustProxy {
  if (setting === undefined) {
    return false;
  }
  if (typeof setting === 'number') {
    return (_address, hop) => hop < setting;
  }
  if (typeof setting === 'object') {
    return [...setting];
  }
  return setting;
}

/**
 * Interpreta `TRUST_PROXY`: `false`, `true`, un número de saltos (1 a 10) o una lista de IP y CIDR
 * separada por comas. Devuelve `undefined` si el valor no es válido, para que el arranque falle
 * en lugar de confiar en algo que no se entendió (fail closed).
 */
export function parseTrustProxy(rawValue: string): TrustProxySetting | undefined {
  const value = rawValue.trim();
  if (value === 'false') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  if (DIGITS_ONLY.test(value)) {
    const hops = Number(value);
    return hops >= 1 && hops <= MAX_TRUSTED_HOPS ? hops : undefined;
  }
  const entries = value.split(',').map((entry) => entry.trim());
  return entries.every(isTrustedAddressOrRange) ? entries : undefined;
}
