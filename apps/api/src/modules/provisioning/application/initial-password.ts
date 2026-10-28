/**
 * Contraseña inicial de un solo uso de la Raíz: la usan el alta de la organización y la recuperación.
 */
import { evaluatePassword } from '../../identity/index.js';
import type { PasswordStrength } from '../../identity/index.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Mayor múltiplo de la longitud del alfabeto que cabe en un byte: descarta el resto (muestreo sin sesgo). */
const LIMIT = 256 - (256 % ALPHABET.length);
const PASSWORD_LENGTH = 24;
const GROUP_SIZE = 6;
const MAX_ATTEMPTS = 5;

/**
 * Contraseña inicial aleatoria de 24 caracteres sin símbolos ambiguos (0/O, 1/l/I), en grupos de
 * seis para dictarla o copiarla sin errores. Muestreo con rechazo: sin sesgo hacia ningún símbolo.
 */
export function generateInitialPassword(
  deps: {
    readonly strength: PasswordStrength;
    readonly randomBytes: (length: number) => Uint8Array;
  },
  personalTokens: readonly string[],
): string {
  const { strength, randomBytes } = deps;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let raw = '';
    while (raw.length < PASSWORD_LENGTH) {
      for (const byte of randomBytes(48)) {
        if (byte < LIMIT && raw.length < PASSWORD_LENGTH)
          raw += ALPHABET.charAt(byte % ALPHABET.length);
      }
    }
    const candidate = (raw.match(new RegExp(`.{${String(GROUP_SIZE)}}`, 'g')) ?? []).join('-');
    const problem = evaluatePassword({
      password: candidate,
      score: strength.score(candidate, personalTokens),
      personalTokens,
    });
    if (problem === null) return candidate;
  }
  throw new Error('Could not generate an acceptable initial password');
}
