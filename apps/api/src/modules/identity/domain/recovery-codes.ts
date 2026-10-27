/**
 * Códigos de recuperación (plan: "Códigos de recuperación"): 10 códigos de un solo uso, mostrados
 * una vez. Formato `XXXX-XXXX-XXXX` (60 bits) con un alfabeto sin caracteres ambiguos (0/O, 1/I).
 */
export const RECOVERY_CODE_COUNT = 10;
/** Códigos de emergencia de la Raíz, emitidos al crear la organización (los custodian dos personas). */
export const EMERGENCY_CODE_COUNT = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 símbolos = 5 bits por carácter
const GROUPS = 3;
const GROUP_LENGTH = 4;

/** Convierte bytes aleatorios en un código con formato. Necesita `GROUPS * GROUP_LENGTH` bytes. */
export function formatRecoveryCode(randomBytes: Uint8Array): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      const byte = randomBytes[g * GROUP_LENGTH + i] ?? 0;
      group += ALPHABET.charAt(byte & 31); // 256 es múltiplo de 32: sin sesgo
    }
    groups.push(group);
  }
  return groups.join('-');
}

export const RECOVERY_CODE_RANDOM_BYTES = GROUPS * GROUP_LENGTH;

/** Mayúsculas y sin guiones ni espacios: se acepta tal como se muestra o escrito de corrido. */
export const normalizeRecoveryCode = (input: string): string =>
  input.replace(/[\s-]/g, '').toUpperCase();
