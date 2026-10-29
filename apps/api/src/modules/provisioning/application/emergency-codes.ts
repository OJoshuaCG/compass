/**
 * Emisión de los códigos de emergencia de la Raíz, repartidos entre sus dos custodios (ADR 0037).
 *
 * Invariante de seguridad: cada custodio conserva los papeles de UN solo grupo, y recuperar a la Raíz
 * exige un código de cada grupo. Por eso la mitad exacta de los códigos es del grupo A y la otra
 * mitad del grupo B: con un reparto desigual un custodio podría reunir el quórum con sus papeles.
 */
import {
  EMERGENCY_CODE_COUNT,
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_RANDOM_BYTES,
} from '../../identity/index.js';

export type CustodyGroup = 'A' | 'B';

export interface IssuedEmergencyCode {
  /** Texto que se imprime; se muestra una sola vez y nunca se guarda. */
  readonly code: string;
  /** SHA-256 del código normalizado: lo único que llega a la base de datos. */
  readonly hash: Uint8Array;
  readonly custodyGroup: CustodyGroup;
}

export interface EmergencyCodePrimitives {
  /** Bytes aleatorios criptográficos (el dominio no importa `node:crypto`). */
  readonly randomBytes: (length: number) => Uint8Array;
  readonly sha256: (data: Uint8Array) => Uint8Array;
}

const CODES_PER_GROUP = EMERGENCY_CODE_COUNT / 2;

export function hashEmergencyCode(
  code: string,
  sha256: EmergencyCodePrimitives['sha256'],
): Uint8Array {
  return sha256(new TextEncoder().encode(normalizeRecoveryCode(code)));
}

export function issueEmergencyCodes(primitives: EmergencyCodePrimitives): IssuedEmergencyCode[] {
  return Array.from({ length: EMERGENCY_CODE_COUNT }, (_unused, index) => {
    const code = formatRecoveryCode(primitives.randomBytes(RECOVERY_CODE_RANDOM_BYTES));
    const custodyGroup: CustodyGroup = index < CODES_PER_GROUP ? 'A' : 'B';
    return { code, hash: hashEmergencyCode(code, primitives.sha256), custodyGroup };
  });
}
