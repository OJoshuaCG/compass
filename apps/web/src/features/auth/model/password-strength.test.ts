import { describe, expect, it } from 'vitest';

import { estimatePasswordStrength } from './password-strength';

describe('estimatePasswordStrength', () => {
  it('scores an empty password as 0', () => {
    expect(estimatePasswordStrength('')).toBe(0);
  });

  it('never rates a password below the 12-character minimum above "weak"', () => {
    expect(estimatePasswordStrength('Xk9#mQ2$')).toBeLessThanOrEqual(1);
    expect(estimatePasswordStrength('Xk9#mQ2$vL')).toBeLessThanOrEqual(1);
  });

  it('rates common passwords as very weak even when they are long enough', () => {
    expect(estimatePasswordStrength('password')).toBe(0);
    expect(estimatePasswordStrength('Password123!')).toBe(0);
  });

  it('penalizes repeated characters and sequences', () => {
    expect(estimatePasswordStrength('aaaaaaaaaaaaaaaa')).toBeLessThanOrEqual(1);
    expect(estimatePasswordStrength('abcdefghijklmnop')).toBeLessThanOrEqual(1);
    expect(estimatePasswordStrength('123456789012345')).toBeLessThanOrEqual(1);
  });

  it('rewards length over composition', () => {
    const phrase = 'caballo bateria grapa correcto';
    expect(estimatePasswordStrength(phrase)).toBe(4);
    expect(estimatePasswordStrength('correcto caballo')).toBeGreaterThanOrEqual(2);
  });
});
