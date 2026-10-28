import pino from 'pino';
import type { Bindings, ChildLoggerOptions, DestinationStream, Logger } from 'pino';

const SENSITIVE_KEYS = [
  'password',
  'secret',
  'token',
  'totp',
  'code',
  'authorization',
  'cookie',
  'ciphertext',
  'wrapped_dek',
] as const;

/**
 * Redacción por configuración (plan: "Logs"): cada clave sensible a profundidad 0, 1 y 2, las
 * cabeceras de petición/respuesta con credenciales y todo el cuerpo de la petición. Los cuerpos
 * de las rutas de revelación, códigos y handoff nunca se registran.
 */
export const REDACT_PATHS: readonly string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_KEYS.map((key) => `*.*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body',
];

const REDACTION_CENSOR = '[Redacted]';
const TRUNCATION_MARKER = '[Truncated]';
const CIRCULAR_MARKER = '[Circular]';

/**
 * Una clave es sensible si alguna de sus palabras empieza por uno de estos prefijos. Se compara
 * por palabras (separadas por mayúsculas, guiones o guiones bajos) y no por nombre exacto para
 * cubrir variantes como `newPassword`, `accessToken`, `set-cookie` o `recoveryCodes`. Prefiere
 * redactar de más: perder un campo de diagnóstico cuesta menos que filtrar un secreto.
 */
const SENSITIVE_WORD_PREFIXES: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'secret',
  'token',
  'totp',
  'otp',
  'code',
  'cookie',
  'authorization',
  'bearer',
  'jwt',
  'credential',
  'ciphertext',
  'dek',
  'seed',
];

/**
 * Raíces largas e inequívocas que se buscan dentro de la clave con los separadores quitados, para
 * atrapar nombres pegados que la división por palabras no separa (`accesstoken`, `apikey`,
 * `privateKey`, `cipherText`). Las raíces cortas y ambiguas (`code`, `otp`, `dek`, `seed`) quedan
 * fuera a propósito: dentro de una palabra mayor producirían falsos positivos.
 */
const SENSITIVE_COMPOUND_STEMS: readonly string[] = [
  'password',
  'passphrase',
  'secret',
  'token',
  'totp',
  'cookie',
  'authorization',
  'ciphertext',
  'apikey',
  'privatekey',
];

/**
 * Claves de diagnóstico que contienen una palabra sensible pero nunca guardan un secreto. Sin esta
 * lista, `statusCode` quedaría como "[Redacted]" y se perdería el estado HTTP de cada log.
 */
const NON_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'statuscode',
  'errorcode',
  'exitcode',
  'httpcode',
]);

const BINARY_MARKER = '[Binary]';
const UNSERIALIZABLE_MARKER = '[Unserializable]';
const PROTO_KEY_ALIAS = '[__proto__]';

/**
 * Profundidad máxima que se recorre. Pasado el límite el subárbol se descarta entero en vez de
 * dejarlo sin revisar: una estructura más honda no debe ser una vía para esquivar la redacción.
 */
const MAX_REDACTION_DEPTH = 8;

/**
 * Tope de elementos por arreglo y de propiedades por objeto. Acota el costo de registrar una
 * estructura enorme; lo que sobra se cuenta en un marcador en lugar de recorrerse.
 */
const MAX_REDACTION_ENTRIES = 1000;

function splitKeyIntoWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  const compactKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (NON_SENSITIVE_KEYS.has(compactKey)) return false;
  if (SENSITIVE_COMPOUND_STEMS.some((stem) => compactKey.includes(stem))) return true;

  return splitKeyIntoWords(key).some((word) =>
    SENSITIVE_WORD_PREFIXES.some((prefix) => word.startsWith(prefix)),
  );
}

function isBinary(value: unknown): boolean {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/**
 * Objetos que se recorren por clave: planos, instancias de clase (DTOs, entidades) y cualquier otro
 * que no tenga un serializador propio de pino o de JSON. Quedan fuera los `Error`, `Date`, `Map`,
 * `Set` y `RegExp`, que pino o JSON tratan por su cuenta y no exponen propiedades con secretos.
 */
function isTraversableObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  return !(
    value instanceof Error ||
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof RegExp
  );
}

function hasToJson(value: object): value is { toJSON: () => unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === 'function';
}

/**
 * Copia el valor redactando, a cualquier profundidad razonable, toda propiedad de clave sensible.
 * Los datos binarios (Buffer, arreglos tipados) nunca se registran: pueden ser una DEK o un texto
 * cifrado bajo una clave de nombre neutro. Los `Error` y `Date` pasan intactos para que los
 * serializadores de pino los traten como siempre. Nunca modifica el objeto original.
 */
function redactDeep(value: unknown, depth: number, visited: WeakSet<object>): unknown {
  if (isBinary(value)) return BINARY_MARKER;

  const isArray = Array.isArray(value);
  if (!isArray && !isTraversableObject(value)) return value;

  if (depth > MAX_REDACTION_DEPTH) return TRUNCATION_MARKER;
  if (visited.has(value)) return CIRCULAR_MARKER;

  // Un `toJSON` propio decidiría lo que se serializa después de la redacción; se resuelve antes
  // para que su resultado también pase por ella.
  if (!isArray && hasToJson(value)) {
    visited.add(value);
    const serialized = redactDeep(value.toJSON(), depth + 1, visited);
    visited.delete(value);
    return serialized;
  }

  visited.add(value);

  if (isArray) {
    const redactedItems = value
      .slice(0, MAX_REDACTION_ENTRIES)
      .map((item) => redactDeep(item, depth + 1, visited));
    if (value.length > MAX_REDACTION_ENTRIES) redactedItems.push(TRUNCATION_MARKER);
    visited.delete(value);
    return redactedItems;
  }

  // Una clave `__proto__` propia (llega con un JSON) se pierde en la serialización de pino y haría
  // desaparecer el subárbol; se renombra para que el diagnóstico sobreviva. El objeto conserva su
  // prototipo normal porque pino llama `hasOwnProperty` sobre los bindings.
  const redactedEntries: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [key, entryValue] of entries.slice(0, MAX_REDACTION_ENTRIES)) {
    const safeKey = key === '__proto__' ? PROTO_KEY_ALIAS : key;
    redactedEntries[safeKey] = isSensitiveKey(key)
      ? REDACTION_CENSOR
      : redactDeep(entryValue, depth + 1, visited);
  }
  if (entries.length > MAX_REDACTION_ENTRIES) redactedEntries['…'] = TRUNCATION_MARKER;
  visited.delete(value);
  return redactedEntries;
}

/**
 * Un getter o un Proxy que lance dentro de `Object.entries` no debe romper la petición que
 * registra el log: se descarta el objeto completo en vez de dejar pasar algo sin redactar. El
 * marcador es un objeto porque pino expande un string en claves numéricas.
 */
function redactSafely(value: Record<string, unknown>): Record<string, unknown> {
  try {
    return redactDeep(value, 0, new WeakSet<object>()) as Record<string, unknown>;
  } catch {
    return { redaction: UNSERIALIZABLE_MARKER };
  }
}

export interface LoggerOptions {
  readonly level: string;
  readonly destination?: DestinationStream;
}

export function createLogger({ level, destination }: LoggerOptions): Logger {
  const rootLogger = pino(
    {
      level,
      // La redacción profunda por palabras va primero; `redact` queda como segunda barrera para
      // las rutas fijas (cabeceras y cuerpo de la petición).
      formatters: {
        log: (logObject) => redactSafely(logObject),
      },
      redact: { paths: [...REDACT_PATHS], censor: REDACTION_CENSOR },
    },
    destination,
  );

  // Pino reinicia el formatter `bindings` en cada `child()`, así que los campos fijos de un hijo
  // no pasarían por la redacción profunda. Los hijos heredan este `child` del logger raíz.
  const originalChild: Logger['child'] = Reflect.get(rootLogger, 'child');
  Object.defineProperty(rootLogger, 'child', {
    value: function child(this: Logger, bindings: Bindings, options?: ChildLoggerOptions) {
      return Reflect.apply(originalChild, this, [redactSafely(bindings), options]) as Logger;
    },
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return rootLogger;
}
