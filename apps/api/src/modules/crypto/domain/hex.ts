/** Hexadecimal sin depender de Node (el dominio y la aplicación no importan `node:*`). */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
