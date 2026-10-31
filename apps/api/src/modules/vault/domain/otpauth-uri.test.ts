import { describe, expect, it } from 'vitest';

import { parseOtpauthUri } from './otpauth-uri.js';

const SECRET_160_BITS = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SECRET_125_BITS = 'GEZDGNBVGY3TQOJQGEZDGNBVG';

const uri = (query: string, type = 'totp'): string =>
  `otpauth://${type}/Brand:ada@brand.example?${query}`;

describe('parseOtpauthUri', () => {
  it('applies the defaults when algorithm, digits and period are missing', () => {
    const parsed = parseOtpauthUri(uri(`secret=${SECRET_160_BITS}&issuer=Brand`));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ algorithm: 'SHA1', digits: 6, periodSeconds: 30 });
  });

  it('normalizes the key: upper case, without spaces or padding', () => {
    const lowerWithSpaces = SECRET_160_BITS.toLowerCase()
      .replace(/(.{4})/g, '$1 ')
      .trim();
    const parsed = parseOtpauthUri(uri(`secret=${encodeURIComponent(lowerWithSpaces)}==`));
    expect(parsed.ok && parsed.value.secretBase32).toBe(SECRET_160_BITS);
  });

  it('accepts SHA256, 8 digits and a 60 s period', () => {
    const parsed = parseOtpauthUri(
      uri(`secret=${SECRET_160_BITS}&algorithm=sha256&digits=8&period=60`),
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      algorithm: 'SHA256',
      digits: 8,
      periodSeconds: 60,
    });
  });

  it.each([
    [
      'a URI that is not otpauth',
      'https://example.test/?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      'not_otpauth',
    ],
    ['text that is not a URI', 'hello', 'not_otpauth'],
    ['HOTP', uri(`secret=${SECRET_160_BITS}&counter=1`, 'hotp'), 'not_totp'],
    ['a missing key', uri('issuer=Brand'), 'secret_missing'],
    ['a key outside Base32', uri('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJ1'), 'secret_invalid'],
    ['a key under 128 bits', uri(`secret=${SECRET_125_BITS}`), 'secret_too_short'],
    [
      'an unsupported algorithm',
      uri(`secret=${SECRET_160_BITS}&algorithm=MD5`),
      'algorithm_unsupported',
    ],
    ['7 digits', uri(`secret=${SECRET_160_BITS}&digits=7`), 'digits_unsupported'],
    ['a 45 s period', uri(`secret=${SECRET_160_BITS}&period=45`), 'period_unsupported'],
  ])('rejects %s', (_name, input, problem) => {
    const parsed = parseOtpauthUri(input);
    expect(parsed).toEqual({ ok: false, problem });
  });

  it('never repeats the key in the normalized URI parameters it rejects', () => {
    const parsed = parseOtpauthUri(uri(`secret=${SECRET_125_BITS}`));
    expect(JSON.stringify(parsed)).not.toContain(SECRET_125_BITS);
  });
});
