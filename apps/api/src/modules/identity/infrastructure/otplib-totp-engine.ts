import { generateSecret, generateURI, verifySync } from 'otplib';

import type { TotpEngine, TotpVerification } from '../application/ports/identity-ports.js';

const ISSUER = 'IAM';
/** Tolerancia de un paso de 30 s hacia cada lado para relojes desfasados. */
const TOLERANCE_SECONDS = 30;

/** TOTP estándar (RFC 6238, SHA-1, 6 dígitos, 30 s) con `otplib`: no se reimplementa. */
export class OtplibTotpEngine implements TotpEngine {
  generateSecret(): string {
    return generateSecret();
  }

  uri(input: { readonly secret: string; readonly accountLabel: string }): string {
    return generateURI({
      strategy: 'totp',
      issuer: ISSUER,
      label: input.accountLabel,
      secret: input.secret,
    });
  }

  verify(secret: string, code: string, now: Date): TotpVerification {
    const result = verifySync({
      secret,
      token: code,
      strategy: 'totp',
      epoch: Math.floor(now.getTime() / 1000),
      epochTolerance: TOLERANCE_SECONDS,
    });
    return result.valid && 'timeStep' in result
      ? { valid: true, step: result.timeStep }
      : { valid: false, step: 0 };
  }
}
