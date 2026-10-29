import { OTPAUTH_URI_MAX_LENGTH } from '@iam/contracts';

/**
 * Lectura de la exportación de Google Authenticator (`otpauth-migration://offline?data=<base64>`).
 *
 * El `data` es un mensaje protobuf (`MigrationPayload`). No se instala ninguna biblioteca de
 * protobuf: el formato es pequeño y fijo, y una dependencia más sería superficie nueva en una pieza
 * que maneja secretos. Se decodifica a mano y de forma defensiva.
 *
 * Invariantes de seguridad
 * - Entrada hostil: cualquier violación de formato o de límites devuelve `{ kind: 'invalid' }`, sin
 *   lanzar y sin ningún dato decodificado (ni en el resultado ni en un mensaje de error).
 * - Los secretos solo salen dentro de `otpauthUri` de cada entrada importable; el `label` no los lleva.
 * - Los bytes decodificados (que contienen los secretos) se ponen a cero al terminar.
 * - Solo se importan cuentas TOTP que el servidor aceptaría: el resto se cuenta, no se arma su URI.
 */

export const MIGRATION_URI_PREFIX = 'otpauth-migration://';

/** Tope del texto completo del enlace. Un QR admite menos de 3 KB: más que esto no es una exportación. */
export const MIGRATION_MAX_URI_LENGTH = 32_768;

/** Tope del base64 ya sin escapes de porcentaje. Acota la memoria antes de decodificar. */
export const MIGRATION_MAX_BASE64_LENGTH = 11_000;

/** Tope del mensaje protobuf decodificado (11 000 caracteres base64 son ~8 250 bytes). */
export const MIGRATION_MAX_PAYLOAD_BYTES = 8_192;

/** Google divide las exportaciones grandes en lotes; 50 cuentas por QR ya es más de lo que cabe en uno. */
export const MIGRATION_MAX_ENTRIES = 50;

/** Rango admitido del secreto de una entrada, en bytes. */
export const MIGRATION_MIN_SECRET_BYTES = 1;
export const MIGRATION_MAX_SECRET_BYTES = 128;

/**
 * Mínimo que acepta el servidor (128 bits, `MIN_SECRET_BITS` en `otpauth-uri.ts` de la API). Muchos
 * servicios emiten claves de 80 bits: esas entradas se omiten como no soportadas en vez de armar un
 * enlace que el servidor va a rechazar.
 */
export const MIGRATION_MIN_IMPORTABLE_SECRET_BYTES = 16;

/** Largo máximo del nombre y del emisor, en caracteres. */
export const MIGRATION_MAX_TEXT_CHARACTERS = 200;

const UTF8_MAX_BYTES_PER_CHARACTER = 4;
const MAX_TEXT_BYTES = MIGRATION_MAX_TEXT_CHARACTERS * UTF8_MAX_BYTES_PER_CHARACTER;

const MAX_VARINT_BYTES = 10;
const MAX_TAG_VALUE = 0xffff_ffff;
const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_CONTINUATION_BIT = 0x80;
const VARINT_BASE = 128;
const WIRE_TYPE_BITS_DIVISOR = 8;

const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;
const FIXED64_BYTES = 8;
const FIXED32_BYTES = 4;

const PAYLOAD_FIELD_OTP_PARAMETERS = 1;
const ENTRY_FIELD_SECRET = 1;
const ENTRY_FIELD_NAME = 2;
const ENTRY_FIELD_ISSUER = 3;
const ENTRY_FIELD_ALGORITHM = 4;
const ENTRY_FIELD_DIGITS = 5;
const ENTRY_FIELD_TYPE = 6;

const OTP_TYPE_HOTP = 1;
const OTP_TYPE_TOTP = 2;

type MigrationAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

/**
 * Enumeración `Algorithm` de Google. 0 (sin especificar) vale SHA1, el valor por omisión de proto3.
 * MD5 (4) y cualquier valor desconocido no están aquí: el servidor no los acepta.
 */
const ALGORITHM_BY_CODE: ReadonlyMap<number, MigrationAlgorithm> = new Map([
  [0, 'SHA1'],
  [1, 'SHA1'],
  [2, 'SHA256'],
  [3, 'SHA512'],
]);

/** Enumeración `DigitCount` de Google. 0 (sin especificar) vale 6 dígitos. */
const DIGITS_BY_CODE: ReadonlyMap<number, 6 | 8> = new Map([
  [0, 6],
  [1, 6],
  [2, 8],
]);

const DEFAULT_ALGORITHM: MigrationAlgorithm = 'SHA1';
const DEFAULT_DIGITS = 6;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_BITS_PER_CHARACTER = 5;
const BASE32_CHARACTER_MASK = 0b11111;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

const BASE64_BITS_PER_CHARACTER = 6;
const BASE64_MAX_PADDING = 2;
const BASE64_INVALID_REMAINDER = 1;

/** Una cuenta importable: lo mínimo para elegirla y para registrarla. */
export type MigrationEntry = {
  /** Emisor y cuenta para mostrar. Nunca incluye el secreto. Puede venir vacío si la cuenta no tiene nombre. */
  label: string;
  /** Enlace `otpauth://totp/` listo para el mismo registro que la clave manual. Lleva el secreto. */
  otpauthUri: string;
};

export type MigrationParseResult =
  | {
      kind: 'ok';
      /** Solo cuentas TOTP que el servidor aceptaría, en el orden de la exportación. */
      entries: MigrationEntry[];
      /** Cuentas HOTP (por contador): no se pueden sincronizar sin estado y no se importan. */
      skippedHotp: number;
      /** Cuentas TOTP que el servidor rechazaría (MD5, clave corta, enlace demasiado largo...). */
      skippedUnsupported: number;
    }
  | { kind: 'invalid' };

const INVALID_RESULT: MigrationParseResult = { kind: 'invalid' };

/** Error interno: nunca lleva mensaje ni datos, y nunca sale del módulo. */
class MalformedMigrationError extends Error {}

function fail(): never {
  throw new MalformedMigrationError();
}

type RawOtpParameters = {
  secret: Uint8Array;
  name: string;
  issuer: string;
  algorithmCode: number;
  digitsCode: number;
  typeCode: number;
};

class ByteReader {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  hasMore(): boolean {
    return this.offset < this.bytes.length;
  }

  /**
   * Varint de hasta 10 bytes. Se acumula como número: por encima de 2^53 pierde precisión, pero esos
   * valores solo aparecen en campos que se saltan o que se comparan con enumeraciones pequeñas, y
   * una longitud inflada se rechaza de todos modos al compararla con los bytes restantes.
   */
  readVarint(): number {
    let result = 0;
    let multiplier = 1;
    for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
      const byte = this.bytes[this.offset];
      if (byte === undefined) return fail();
      this.offset += 1;
      result += (byte & VARINT_PAYLOAD_MASK) * multiplier;
      if ((byte & VARINT_CONTINUATION_BIT) === 0) return result;
      multiplier *= VARINT_BASE;
    }
    return fail();
  }

  readTag(): { fieldNumber: number; wireType: number } {
    const tag = this.readVarint();
    if (tag > MAX_TAG_VALUE) return fail();
    const fieldNumber = Math.floor(tag / WIRE_TYPE_BITS_DIVISOR);
    if (fieldNumber === 0) return fail();
    return { fieldNumber, wireType: tag % WIRE_TYPE_BITS_DIVISOR };
  }

  readLengthDelimited(): Uint8Array {
    const length = this.readVarint();
    if (length > this.bytes.length - this.offset) return fail();
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  private skipBytes(count: number): void {
    if (count > this.bytes.length - this.offset) return fail();
    this.offset += count;
  }

  /** Salta un campo desconocido. Los grupos (wire types 3 y 4) y los tipos 6 y 7 no son válidos aquí. */
  skipField(wireType: number): void {
    switch (wireType) {
      case WIRE_TYPE_VARINT:
        this.readVarint();
        return;
      case WIRE_TYPE_FIXED64:
        this.skipBytes(FIXED64_BYTES);
        return;
      case WIRE_TYPE_LENGTH_DELIMITED:
        this.readLengthDelimited();
        return;
      case WIRE_TYPE_FIXED32:
        this.skipBytes(FIXED32_BYTES);
        return;
      default:
        return fail();
    }
  }
}

/** UTF-8 estricto: un byte inválido invalida toda la exportación en vez de sustituirse por U+FFFD. */
function decodeStrictText(bytes: Uint8Array): string {
  if (bytes.length > MAX_TEXT_BYTES) return fail();
  let text: string;
  try {
    // `ignoreBOM` para que un BOM inicial no se descarte en silencio y cambie el texto.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail();
  }
  if (Array.from(text).length > MIGRATION_MAX_TEXT_CHARACTERS) return fail();
  return text;
}

function parseOtpParameters(bytes: Uint8Array): RawOtpParameters {
  const reader = new ByteReader(bytes);
  let secret: Uint8Array | undefined;
  let name = '';
  let issuer = '';
  let algorithmCode = 0;
  let digitsCode = 0;
  let typeCode = 0;

  while (reader.hasMore()) {
    const { fieldNumber, wireType } = reader.readTag();
    const isLengthDelimited = wireType === WIRE_TYPE_LENGTH_DELIMITED;
    const isVarint = wireType === WIRE_TYPE_VARINT;
    if (fieldNumber === ENTRY_FIELD_SECRET && isLengthDelimited) {
      secret = reader.readLengthDelimited();
    } else if (fieldNumber === ENTRY_FIELD_NAME && isLengthDelimited) {
      name = decodeStrictText(reader.readLengthDelimited());
    } else if (fieldNumber === ENTRY_FIELD_ISSUER && isLengthDelimited) {
      issuer = decodeStrictText(reader.readLengthDelimited());
    } else if (fieldNumber === ENTRY_FIELD_ALGORITHM && isVarint) {
      algorithmCode = reader.readVarint();
    } else if (fieldNumber === ENTRY_FIELD_DIGITS && isVarint) {
      digitsCode = reader.readVarint();
    } else if (fieldNumber === ENTRY_FIELD_TYPE && isVarint) {
      typeCode = reader.readVarint();
    } else if (fieldNumber >= ENTRY_FIELD_SECRET && fieldNumber <= ENTRY_FIELD_TYPE) {
      // Un campo conocido con un wire type que no le corresponde: el mensaje está mal formado.
      return fail();
    } else {
      // Campos desconocidos (el contador, campos futuros): se saltan sin interpretarlos.
      reader.skipField(wireType);
    }
  }

  if (secret === undefined) return fail();
  if (secret.length < MIGRATION_MIN_SECRET_BYTES || secret.length > MIGRATION_MAX_SECRET_BYTES) {
    return fail();
  }
  return { secret, name, issuer, algorithmCode, digitsCode, typeCode };
}

function parsePayload(bytes: Uint8Array): RawOtpParameters[] {
  const reader = new ByteReader(bytes);
  const entries: RawOtpParameters[] = [];
  while (reader.hasMore()) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === PAYLOAD_FIELD_OTP_PARAMETERS) {
      if (wireType !== WIRE_TYPE_LENGTH_DELIMITED) return fail();
      if (entries.length >= MIGRATION_MAX_ENTRIES) return fail();
      entries.push(parseOtpParameters(reader.readLengthDelimited()));
    } else {
      // version, batch_size, batch_index, batch_id y cualquier campo futuro.
      reader.skipField(wireType);
    }
  }
  return entries;
}

function base64SextetOf(character: string): number {
  const code = character.charCodeAt(0);
  const isUpper = code >= 65 && code <= 90;
  const isLower = code >= 97 && code <= 122;
  const isDigit = code >= 48 && code <= 57;
  if (isUpper) return code - 65;
  if (isLower) return code - 97 + 26;
  if (isDigit) return code - 48 + 52;
  // Alfabeto estándar y alfabeto seguro para URL, indistintamente.
  if (character === '+' || character === '-') return 62;
  if (character === '/' || character === '_') return 63;
  return -1;
}

/** Base64 estándar o seguro para URL, con o sin relleno. `null` ante cualquier carácter o largo inválido. */
function decodeBase64(text: string): Uint8Array | null {
  let end = text.length;
  while (end > 0 && text.charAt(end - 1) === '=') end -= 1;
  if (text.length - end > BASE64_MAX_PADDING) return null;
  if (end === 0 || end > MIGRATION_MAX_BASE64_LENGTH) return null;
  if (end % 4 === BASE64_INVALID_REMAINDER) return null;

  const output = new Uint8Array(Math.floor((end * BASE64_BITS_PER_CHARACTER) / BITS_PER_BYTE));
  let buffer = 0;
  let bitCount = 0;
  let written = 0;
  for (let index = 0; index < end; index += 1) {
    const sextet = base64SextetOf(text.charAt(index));
    if (sextet < 0) return null;
    buffer = (buffer << BASE64_BITS_PER_CHARACTER) | sextet;
    bitCount += BASE64_BITS_PER_CHARACTER;
    if (bitCount >= BITS_PER_BYTE) {
      bitCount -= BITS_PER_BYTE;
      output[written] = (buffer >> bitCount) & BYTE_MASK;
      written += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }
  if (output.length > MIGRATION_MAX_PAYLOAD_BYTES) return null;
  return output;
}

/** Extrae y decodifica el parámetro `data` sin pasar por `URLSearchParams`, que convertiría `+` en espacio. */
function decodeDataParameter(uri: string): Uint8Array | null {
  if (uri.length > MIGRATION_MAX_URI_LENGTH) return null;
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith(MIGRATION_URI_PREFIX)) return null;
  const queryStart = trimmed.indexOf('?');
  if (queryStart < 0) return null;

  const dataPart = trimmed
    .slice(queryStart + 1)
    .split('&')
    .find((part) => part.startsWith('data='));
  if (dataPart === undefined) return null;

  let base64Text: string;
  try {
    base64Text = decodeURIComponent(dataPart.slice('data='.length));
  } catch {
    return null;
  }
  return decodeBase64(base64Text);
}

function encodeBase32(bytes: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    buffer = (buffer << BITS_PER_BYTE) | byte;
    bitCount += BITS_PER_BYTE;
    while (bitCount >= BASE32_BITS_PER_CHARACTER) {
      output += BASE32_ALPHABET.charAt(
        (buffer >> (bitCount - BASE32_BITS_PER_CHARACTER)) & BASE32_CHARACTER_MASK,
      );
      bitCount -= BASE32_BITS_PER_CHARACTER;
    }
    buffer &= (1 << bitCount) - 1;
  }
  if (bitCount > 0) {
    output += BASE32_ALPHABET.charAt(
      (buffer << (BASE32_BITS_PER_CHARACTER - bitCount)) & BASE32_CHARACTER_MASK,
    );
  }
  return output;
}

type EntryOutcome =
  { kind: 'importable'; entry: MigrationEntry } | { kind: 'hotp' } | { kind: 'unsupported' };

/**
 * Google suele guardar el nombre como `Emisor:cuenta` y repetir el emisor aparte. Se quita el prefijo
 * repetido para no mostrar ni enviar «Acme:Acme:ana».
 */
function splitAccountName(issuer: string, name: string): string {
  const issuerPrefix = `${issuer}:`;
  if (issuer !== '' && name.startsWith(issuerPrefix)) return name.slice(issuerPrefix.length).trim();
  return name;
}

function displayLabelOf(issuer: string, account: string): string {
  if (issuer === '') return account;
  if (account === '') return issuer;
  return `${issuer}: ${account}`;
}

function uriLabelOf(issuer: string, account: string): string {
  if (issuer !== '' && account !== '') {
    return `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  }
  if (issuer !== '') return encodeURIComponent(issuer);
  return encodeURIComponent(account);
}

function toEntryOutcome(raw: RawOtpParameters): EntryOutcome {
  if (raw.typeCode === OTP_TYPE_HOTP) return { kind: 'hotp' };
  // Un tipo sin especificar o desconocido no se puede tratar como TOTP con seguridad.
  if (raw.typeCode !== OTP_TYPE_TOTP) return { kind: 'unsupported' };

  const algorithm = ALGORITHM_BY_CODE.get(raw.algorithmCode);
  const digits = DIGITS_BY_CODE.get(raw.digitsCode);
  if (algorithm === undefined || digits === undefined) return { kind: 'unsupported' };
  if (raw.secret.length < MIGRATION_MIN_IMPORTABLE_SECRET_BYTES) return { kind: 'unsupported' };

  const account = splitAccountName(raw.issuer, raw.name);
  const queryParts = [`secret=${encodeBase32(raw.secret)}`];
  if (raw.issuer !== '') queryParts.push(`issuer=${encodeURIComponent(raw.issuer)}`);
  // Solo se añaden cuando difieren del valor por omisión, como hacen las plataformas.
  if (algorithm !== DEFAULT_ALGORITHM) queryParts.push(`algorithm=${algorithm}`);
  if (digits !== DEFAULT_DIGITS) queryParts.push(`digits=${String(digits)}`);

  const otpauthUri = `otpauth://totp/${uriLabelOf(raw.issuer, account)}?${queryParts.join('&')}`;
  // El servidor rechaza enlaces más largos: con nombres de 200 caracteres escapados puede pasar.
  if (otpauthUri.length > OTPAUTH_URI_MAX_LENGTH) return { kind: 'unsupported' };

  return { kind: 'importable', entry: { label: displayLabelOf(raw.issuer, account), otpauthUri } };
}

/**
 * Lee una exportación de Google Authenticator. Nunca lanza: lo que no sea una exportación válida y
 * acotada devuelve `{ kind: 'invalid' }`, sin pistas sobre el contenido.
 */
export function parseGoogleAuthenticatorMigration(uri: string): MigrationParseResult {
  const payloadBytes = decodeDataParameter(uri);
  if (payloadBytes === null) return INVALID_RESULT;
  try {
    const rawEntries = parsePayload(payloadBytes);
    // Una exportación sin ninguna cuenta no es una exportación útil: se trata como inválida.
    if (rawEntries.length === 0) return INVALID_RESULT;

    const entries: MigrationEntry[] = [];
    let skippedHotp = 0;
    let skippedUnsupported = 0;
    for (const raw of rawEntries) {
      const outcome = toEntryOutcome(raw);
      if (outcome.kind === 'importable') entries.push(outcome.entry);
      else if (outcome.kind === 'hotp') skippedHotp += 1;
      else skippedUnsupported += 1;
    }
    return { kind: 'ok', entries, skippedHotp, skippedUnsupported };
  } catch {
    return INVALID_RESULT;
  } finally {
    // Los secretos en claro no deben sobrevivir a la lectura más allá del enlace de cada entrada.
    payloadBytes.fill(0);
  }
}
