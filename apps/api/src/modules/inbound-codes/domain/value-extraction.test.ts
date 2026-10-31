import { describe, expect, it } from 'vitest';

import { extractAllowedLink, extractFixedLengthCode } from './value-extraction.js';
import type { AllowedLinkRule, FixedLengthCodeRule } from './inbound-template.js';

const BODY_LIMIT = 64 * 1024;

const SIX_DIGIT_RULE: FixedLengthCodeRule = {
  type: 'fixed_length_code',
  leadingLiteral: 'Tu código es: ',
  codeLength: 6,
  charset: 'digits',
  trailingLiteral: '',
};

const LINK_RULE: AllowedLinkRule = {
  type: 'allowed_host_link',
  allowedHosts: ['www.facebook.com'],
  pathPrefix: '/recover',
};

// SENSIBLE (revisión humana)
describe('fixed-length code extraction', () => {
  it('returns the code only when anchor and exact length match', () => {
    expect(extractFixedLengthCode('Hola\nTu código es: 482913\nAdiós', SIX_DIGIT_RULE)).toEqual({
      found: true,
      value: '482913',
    });
  });

  it('does not return a 6-digit code out of a longer or shorter run of digits', () => {
    expect(extractFixedLengthCode('Tu código es: 48291355', SIX_DIGIT_RULE)).toEqual({
      found: false,
      reason: 'NOT_FOUND',
    });
    expect(extractFixedLengthCode('Tu código es: 48291', SIX_DIGIT_RULE)).toEqual({
      found: false,
      reason: 'NOT_FOUND',
    });
  });

  it('does not match without the anchor, nor with a different anchor case', () => {
    expect(extractFixedLengthCode('Código 482913', SIX_DIGIT_RULE).found).toBe(false);
    expect(extractFixedLengthCode('tu código es: 482913', SIX_DIGIT_RULE).found).toBe(false);
  });

  it('only accepts ASCII digits: fullwidth and Arabic-Indic digits do not count', () => {
    expect(extractFixedLengthCode('Tu código es: ４８２９１３', SIX_DIGIT_RULE).found).toBe(false);
    expect(extractFixedLengthCode('Tu código es: ٤٨٢٩١٣', SIX_DIGIT_RULE).found).toBe(false);
  });

  it('requires the trailing literal immediately after the code when the rule has one', () => {
    const rule: FixedLengthCodeRule = { ...SIX_DIGIT_RULE, trailingLiteral: ' para entrar' };

    expect(extractFixedLengthCode('Tu código es: 482913 para entrar', rule).found).toBe(true);
    expect(extractFixedLengthCode('Tu código es: 482913. para entrar', rule).found).toBe(false);
  });

  it('supports an alphanumeric charset', () => {
    const rule: FixedLengthCodeRule = { ...SIX_DIGIT_RULE, charset: 'alphanumeric' };

    expect(extractFixedLengthCode('Tu código es: A1b2C3', rule)).toEqual({
      found: true,
      value: 'A1b2C3',
    });
    expect(extractFixedLengthCode('Tu código es: A1b2C3D', rule).found).toBe(false);
  });

  it('is not altered by attacker text: a second, different code makes the result ambiguous', () => {
    const body = 'Nombre: Tu código es: 000000\nTu código es: 482913';

    expect(extractFixedLengthCode(body, SIX_DIGIT_RULE)).toEqual({
      found: false,
      reason: 'AMBIGUOUS',
    });
  });

  it('accepts the same code repeated (a legitimate message may repeat it)', () => {
    const body = 'Tu código es: 482913\nRepetimos. Tu código es: 482913';
    expect(extractFixedLengthCode(body, SIX_DIGIT_RULE)).toEqual({ found: true, value: '482913' });
  });

  it('does not treat the pattern as a regular expression', () => {
    const regexLike: FixedLengthCodeRule = { ...SIX_DIGIT_RULE, leadingLiteral: '(a+)+$' };

    expect(extractFixedLengthCode('aaaaaaaaaaaaaaaaaaaaaaaaaaaa!', regexLike).found).toBe(false);
    expect(extractFixedLengthCode('(a+)+$482913', regexLike)).toEqual({
      found: true,
      value: '482913',
    });
  });

  it('rejects an oversized body instead of truncating it', () => {
    const body = `Tu código es: 482913${'x'.repeat(BODY_LIMIT)}`;
    expect(extractFixedLengthCode(body, SIX_DIGIT_RULE)).toEqual({
      found: false,
      reason: 'BODY_TOO_LARGE',
    });
  });

  it('stays fast on a hostile body full of near-matches', () => {
    const body = 'Tu código es: '.repeat(Math.floor(BODY_LIMIT / 14));
    const startedAt = Date.now();

    expect(extractFixedLengthCode(body, SIX_DIGIT_RULE).found).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('returns not found for an empty anchor instead of matching everywhere', () => {
    expect(extractFixedLengthCode('482913', { ...SIX_DIGIT_RULE, leadingLiteral: '' }).found).toBe(
      false,
    );
  });
});

// SENSIBLE (revisión humana)
describe('allowed-host link extraction', () => {
  it('returns a link whose host is in the allowed list and path matches the prefix', () => {
    const body = 'Restablece aquí: https://www.facebook.com/recover?token=abc123 gracias';

    expect(extractAllowedLink(body, LINK_RULE)).toEqual({
      found: true,
      value: 'https://www.facebook.com/recover?token=abc123',
    });
  });

  it('never returns a link whose host is not allowed', () => {
    const hostileLinks = [
      'https://evil.example/recover?token=abc',
      'https://www.facebook.com.evil.example/recover',
      'https://evil.example/www.facebook.com/recover',
      'https://evil.example?x=www.facebook.com/recover',
      'https://facebook.com/recover',
      'https://sub.www.facebook.com/recover',
    ];
    for (const link of hostileLinks) {
      expect(extractAllowedLink(`Enlace: ${link}`, LINK_RULE).found).toBe(false);
    }
  });

  it('rejects userinfo, ports, backslash tricks and percent-encoded hosts', () => {
    const hostileLinks = [
      'https://www.facebook.com@evil.example/recover',
      'https://www.facebook.com:8443/recover',
      'https://evil.example\\@www.facebook.com/recover',
      'https://www.facebook.com%2eevil.example/recover',
    ];
    for (const link of hostileLinks) {
      expect(extractAllowedLink(`Enlace: ${link}`, LINK_RULE).found).toBe(false);
    }
  });

  it('only accepts https, even for an allowed host', () => {
    expect(extractAllowedLink('http://www.facebook.com/recover', LINK_RULE).found).toBe(false);
    expect(extractAllowedLink('Enlace: ftp://www.facebook.com/recover', LINK_RULE).found).toBe(
      false,
    );
  });

  it('ignores allowed-host links outside the path prefix (for example an unsubscribe link)', () => {
    expect(extractAllowedLink('https://www.facebook.com/unsubscribe?id=1', LINK_RULE).found).toBe(
      false,
    );
  });

  it('is ambiguous when two different allowed links are present', () => {
    const body =
      'https://www.facebook.com/recover?token=A y https://www.facebook.com/recover?token=B';
    expect(extractAllowedLink(body, LINK_RULE)).toEqual({ found: false, reason: 'AMBIGUOUS' });
  });

  it('ignores a disallowed link next to an allowed one and returns only the allowed one', () => {
    const body = 'https://evil.example/recover y https://www.facebook.com/recover?token=A';
    expect(extractAllowedLink(body, LINK_RULE)).toEqual({
      found: true,
      value: 'https://www.facebook.com/recover?token=A',
    });
  });

  it('stays fast on a hostile body of back-to-back link schemes (no quadratic scan)', () => {
    const body = 'https://'.repeat(Math.floor(BODY_LIMIT / 8));
    const startedAt = Date.now();

    expect(extractAllowedLink(body, LINK_RULE).found).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('ignores oversized candidates and never throws on malformed ones', () => {
    const oversized = `https://www.facebook.com/recover?t=${'a'.repeat(5000)}`;
    expect(extractAllowedLink(oversized, LINK_RULE).found).toBe(false);
    expect(extractAllowedLink('https:// https://[::1 https://%zz', LINK_RULE).found).toBe(false);
  });

  it('rejects an oversized body', () => {
    const body = `https://www.facebook.com/recover?t=1 ${'x'.repeat(BODY_LIMIT)}`;
    expect(extractAllowedLink(body, LINK_RULE)).toEqual({ found: false, reason: 'BODY_TOO_LARGE' });
  });
});
