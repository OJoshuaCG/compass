import { createRequire } from 'node:module';
import { deflateSync, crc32 } from 'node:zlib';

/**
 * Genera, solo en memoria, imágenes PNG de códigos QR sintéticos para los specs de importación.
 * Nunca se escribe nada en disco y nunca se usan secretos reales: lo que se codifica son claves
 * obviamente falsas definidas en cada spec.
 */

type QrModules = { size: number; get: (row: number, column: number) => number };
type QrCreate = (text: string, options: { errorCorrectionLevel: string }) => { modules: QrModules };

// `qrcode` es una dependencia de `@iam/web` (la usa la propia app para pintar el QR del alta) y no
// del paquete e2e: se resuelve desde allí para no agregar ninguna dependencia nueva.
const requireFromWeb = createRequire(
  createRequire(import.meta.url).resolve('@iam/web/package.json'),
);
const createQr = (requireFromWeb('qrcode') as { create: QrCreate }).create;

const MODULE_SIZE_PX = 6;
// Margen blanco que exige la especificación de QR para que el detector encuentre los bordes.
const QUIET_ZONE_MODULES = 4;
const WHITE = 255;
const BLACK = 0;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BIT_DEPTH = 8;
const PNG_COLOR_TYPE_GRAYSCALE = 0;

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

/** PNG en escala de grises de 8 bits: suficiente para un QR en blanco y negro. */
export function qrPng(text: string): Buffer {
  const { modules } = createQr(text, { errorCorrectionLevel: 'M' });
  const side = (modules.size + QUIET_ZONE_MODULES * 2) * MODULE_SIZE_PX;

  // Cada fila lleva un byte de filtro (0 = sin filtro) antes de sus píxeles.
  const raw = Buffer.alloc((side + 1) * side, WHITE);
  for (let y = 0; y < side; y += 1) {
    const rowStart = y * (side + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < side; x += 1) {
      const moduleRow = Math.floor(y / MODULE_SIZE_PX) - QUIET_ZONE_MODULES;
      const moduleColumn = Math.floor(x / MODULE_SIZE_PX) - QUIET_ZONE_MODULES;
      const isInsideCode =
        moduleRow >= 0 &&
        moduleColumn >= 0 &&
        moduleRow < modules.size &&
        moduleColumn < modules.size;
      const isDark = isInsideCode && modules.get(moduleRow, moduleColumn) === 1;
      raw[rowStart + 1 + x] = isDark ? BLACK : WHITE;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = PNG_BIT_DEPTH;
  header[9] = PNG_COLOR_TYPE_GRAYSCALE;
  // Compresión, filtro y entrelazado en 0 (los únicos valores definidos por la especificación).
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BITS_PER_BYTE = 8;
const BITS_PER_BASE32_CHARACTER = 5;

/** Base32 (RFC 4648, sin relleno) de un texto UTF-8: es la forma en que el servidor guarda la clave. */
export function base32OfText(text: string): string {
  let output = '';
  let buffer = 0;
  let bitCount = 0;
  for (const byte of Buffer.from(text, 'utf-8')) {
    buffer = (buffer << BITS_PER_BYTE) | byte;
    bitCount += BITS_PER_BYTE;
    while (bitCount >= BITS_PER_BASE32_CHARACTER) {
      output += BASE32_ALPHABET.charAt((buffer >> (bitCount - BITS_PER_BASE32_CHARACTER)) & 31);
      bitCount -= BITS_PER_BASE32_CHARACTER;
    }
    buffer &= (1 << bitCount) - 1;
  }
  if (bitCount > 0) {
    output += BASE32_ALPHABET.charAt((buffer << (BITS_PER_BASE32_CHARACTER - bitCount)) & 31);
  }
  return output;
}

export type MigrationAccount = {
  /** Texto de la clave (se codifica tal cual en UTF-8); mínimo 16 caracteres para ser importable. */
  secretText: string;
  name: string;
  issuer: string;
  /** Por omisión TOTP; `hotp` representa una cuenta por contador, que no se puede importar. */
  kind?: 'totp' | 'hotp';
};

const TYPE_HOTP = 1;
const TYPE_TOTP = 2;
const ALGORITHM_SHA1 = 1;
const DIGITS_SIX = 1;

function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return bytes;
}

function lengthDelimited(fieldNumber: number, payload: readonly number[]): number[] {
  return [...varint(fieldNumber * 8 + 2), ...varint(payload.length), ...payload];
}

function varintField(fieldNumber: number, value: number): number[] {
  return [...varint(fieldNumber * 8), ...varint(value)];
}

function utf8(text: string): number[] {
  return Array.from(Buffer.from(text, 'utf-8'));
}

/** Enlace `otpauth-migration://` con el formato (protobuf) que exporta Google Authenticator. */
export function migrationUri(accounts: readonly MigrationAccount[]): string {
  const payload = accounts.flatMap((account) =>
    lengthDelimited(1, [
      ...lengthDelimited(1, utf8(account.secretText)),
      ...lengthDelimited(2, utf8(account.name)),
      ...lengthDelimited(3, utf8(account.issuer)),
      ...varintField(4, ALGORITHM_SHA1),
      ...varintField(5, DIGITS_SIX),
      ...varintField(6, account.kind === 'hotp' ? TYPE_HOTP : TYPE_TOTP),
    ]),
  );
  const bytes = [...payload, ...varintField(2, 1), ...varintField(3, 1), ...varintField(4, 0)];
  return `otpauth-migration://offline?data=${encodeURIComponent(Buffer.from(bytes).toString('base64'))}`;
}
