/**
 * Genera exportaciones de Google Authenticator SINTÉTICAS para las pruebas de componente y del
 * decodificador de QR (ningún QR real). Solo existe en pruebas: la app no lo importa.
 */

export type FixtureEntry = {
  /** Texto del secreto; se codifica tal cual (UTF-8). Mínimo 16 caracteres para que sea importable. */
  secretText: string;
  name: string;
  issuer: string;
  /** 1 = HOTP, 2 = TOTP. */
  type?: number;
  /** 1 = SHA1, 2 = SHA256, 3 = SHA512, 4 = MD5. */
  algorithm?: number;
};

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
  return Array.from(new TextEncoder().encode(text));
}

export function buildMigrationUri(entries: readonly FixtureEntry[]): string {
  const payload = entries.flatMap((entry) =>
    lengthDelimited(1, [
      ...lengthDelimited(1, utf8(entry.secretText)),
      ...lengthDelimited(2, utf8(entry.name)),
      ...lengthDelimited(3, utf8(entry.issuer)),
      ...varintField(4, entry.algorithm ?? ALGORITHM_SHA1),
      ...varintField(5, DIGITS_SIX),
      ...varintField(6, entry.type ?? TYPE_TOTP),
    ]),
  );
  const bytes = [...payload, ...varintField(2, 1), ...varintField(3, 1), ...varintField(4, 0)];
  const base64 = btoa(String.fromCharCode(...bytes));
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}
