import { createHash } from 'node:crypto';

/** SHA-256 en hexadecimal. Lo expone la fachada para que `audit` encadene hashes sin importar `node:crypto`. */
export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}
