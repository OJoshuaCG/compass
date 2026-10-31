import { describe, expect, it } from 'vitest';

import { toAsciiLowercase } from './ascii-text.js';
import { normalizeEmailAddress } from './mail-address.js';

const MAX_ADDRESS_LENGTH = 254;

// SENSIBLE (revisión humana)
describe('address normalization (minimal, exact comparison)', () => {
  it('lowercases A-Z only and returns parts', () => {
    expect(normalizeEmailAddress('Security@Facebook.COM')).toEqual({
      address: 'security@facebook.com',
      localPart: 'security',
      domain: 'facebook.com',
    });
  });

  it('does not fold Unicode: the Kelvin sign and fullwidth letters stay distinct and are rejected', () => {
    expect(toAsciiLowercase('K')).toBe('K');
    expect(normalizeEmailAddress('security@Kacebook.com')).toBeNull();
    expect(normalizeEmailAddress('ｓecurity@facebook.com')).toBeNull();
  });

  it('rejects confusable Unicode (Cyrillic) in local part and domain', () => {
    expect(normalizeEmailAddress('sеcurity@facebook.com')).toBeNull();
    expect(normalizeEmailAddress('security@facebооk.com')).toBeNull();
  });

  it('rejects whitespace, controls, display names and several addresses', () => {
    const hostile = [
      ' security@facebook.com',
      'security@facebook.com ',
      'security@face book.com',
      'security@facebook.com\n',
      'security@facebook.com\u0000',
      'Security <security@facebook.com>',
      'a@b.com;c@d.com',
      'a@b.com,c@d.com',
    ];
    for (const address of hostile) expect(normalizeEmailAddress(address)).toBeNull();
  });

  it('rejects structurally broken addresses', () => {
    const broken = [
      '',
      '@',
      'a@',
      '@b.com',
      'a@@b.com',
      'a@b@c.com',
      'a@.b.com',
      'a@b.com.',
      'a@b..com',
    ];
    for (const address of broken) expect(normalizeEmailAddress(address)).toBeNull();
  });

  it('rejects an oversized address and accepts one at the limit', () => {
    const domain = '@b.com';
    const atLimit = `${'a'.repeat(MAX_ADDRESS_LENGTH - domain.length)}${domain}`;

    expect(normalizeEmailAddress(atLimit)).not.toBeNull();
    expect(normalizeEmailAddress(`a${atLimit}`)).toBeNull();
  });

  it('does not treat a sender that merely contains the exact one as equal', () => {
    const exact = normalizeEmailAddress('security@facebook.com');
    const prefixed = normalizeEmailAddress('x-security@facebook.com');
    const suffixed = normalizeEmailAddress('security@facebook.com.evil.example');

    expect(prefixed?.address).not.toBe(exact?.address);
    expect(suffixed?.address).not.toBe(exact?.address);
  });
});
