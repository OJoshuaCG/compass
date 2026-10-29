import { describe, expect, it } from 'vitest';

import { OtplibTotpGenerator } from './otplib-totp-generator.js';

// Vectores de prueba del apéndice B del RFC 6238 (8 dígitos, periodo de 30 s).
const SHA1_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SHA256_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====';
const SHA512_SECRET =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=';

const atSeconds = (seconds: number): Date => new Date(seconds * 1000);
const parameters = (algorithm: 'SHA1' | 'SHA256' | 'SHA512') =>
  ({ algorithm, digits: 8, periodSeconds: 30 }) as const;

describe('OtplibTotpGenerator (RFC 6238 test vectors)', () => {
  const generator = new OtplibTotpGenerator();

  it.each([
    ['SHA1', SHA1_SECRET, 59, '94287082'],
    ['SHA1', SHA1_SECRET, 1111111109, '07081804'],
    ['SHA256', SHA256_SECRET, 59, '46119246'],
    ['SHA512', SHA512_SECRET, 59, '90693936'],
  ] as const)('%s at %i s gives %s', (algorithm, secret, seconds, expected) => {
    expect(generator.codeAt(secret, parameters(algorithm), atSeconds(seconds))).toBe(expected);
  });

  it('honours the digits and the period of the registered parameters', () => {
    const sixDigits = generator.codeAt(
      SHA1_SECRET,
      { algorithm: 'SHA1', digits: 6, periodSeconds: 30 },
      atSeconds(59),
    );
    expect(sixDigits).toBe('287082');

    const longPeriod = { algorithm: 'SHA1', digits: 6, periodSeconds: 60 } as const;
    expect(generator.codeAt(SHA1_SECRET, longPeriod, atSeconds(60))).toBe(
      generator.codeAt(SHA1_SECRET, longPeriod, atSeconds(119)),
    );
    expect(generator.codeAt(SHA1_SECRET, longPeriod, atSeconds(60))).not.toBe(
      generator.codeAt(SHA1_SECRET, longPeriod, atSeconds(120)),
    );
  });
});
