/**
 * Invariantes de seguridad
 * - Las contraseñas de usuarios se guardan SOLO como hash Argon2id; nunca cifradas ni registradas.
 * - Parámetros mínimos de OWASP (19 MiB, 2 pasadas, 1 hilo); se recalibran por hardware.
 */
import { Algorithm, hash, verify } from '@node-rs/argon2';

import type { PasswordHasher } from '../application/ports/identity-ports.js';

export interface Argon2Params {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

export const OWASP_ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly params: Argon2Params = OWASP_ARGON2_PARAMS) {}

  hash(password: string): Promise<string> {
    return hash(password, { algorithm: Algorithm.Argon2id, ...this.params });
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password);
    } catch {
      // Un hash ilegible nunca autentica.
      return false;
    }
  }
}
