/** Tokens de sesión e invitación: 256 bits aleatorios; en base de datos solo se guarda su SHA-256. */
export const TOKEN_BYTES = 32;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url sin relleno, sin depender de Node. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET.charAt((buffer >> bits) & 63);
    }
  }
  if (bits > 0) out += ALPHABET.charAt((buffer << (6 - bits)) & 63);
  return out;
}
