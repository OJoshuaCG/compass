import { generateSync } from 'otplib';

import type { TotpParameters } from '../domain/otpauth-uri.js';
import type { TotpGenerator } from '../application/ports/totp-generator.js';

const MILLISECONDS_PER_SECOND = 1000;

/** TOTP con `otplib` y los parámetros del URI registrado: no se reimplementa el algoritmo. */
export class OtplibTotpGenerator implements TotpGenerator {
  codeAt(secretBase32: string, parameters: TotpParameters, at: Date): string {
    return generateSync({
      strategy: 'totp',
      secret: secretBase32,
      algorithm: parameters.algorithm.toLowerCase() as 'sha1' | 'sha256' | 'sha512',
      digits: parameters.digits,
      period: parameters.periodSeconds,
      epoch: Math.floor(at.getTime() / MILLISECONDS_PER_SECOND),
    });
  }
}
