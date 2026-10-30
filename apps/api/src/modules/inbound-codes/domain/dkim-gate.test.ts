import { describe, expect, it } from 'vitest';

import {
  FIXTURE_ALIAS,
  FIXTURE_NOW,
  FIXTURE_SENDER,
  buildGateInput,
  buildSignature,
} from '../testing/mail-fixtures.js';
import { DKIM_REJECTION_REASONS, evaluateDkimGate } from './dkim-gate.js';
import type { DkimRejectionReason } from './dkim-gate.js';

const MILLISECONDS_PER_MINUTE = 60 * 1000;

function rejectionOf(input: ReturnType<typeof buildGateInput>): DkimRejectionReason | null {
  const result = evaluateDkimGate(input);
  return result.accepted ? null : result.reason;
}

// SENSIBLE (revisión humana)
describe('DKIM gate', () => {
  it('accepts a fully compliant, strictly aligned signature and returns the normalized sender', () => {
    const result = evaluateDkimGate(buildGateInput({ fromAddress: 'Security@Facebook.COM' }));

    expect(result).toEqual({
      accepted: true,
      signingDomain: 'facebook.com',
      fromAddress: FIXTURE_SENDER,
    });
  });

  describe('alignment (strict)', () => {
    it('rejects a valid signature whose d= differs from the From domain', () => {
      const input = buildGateInput({
        validatedSignatures: [buildSignature({ signingDomain: 'atacante.example' })],
      });
      expect(rejectionOf(input)).toBe('DOMAIN_NOT_ALIGNED');
    });

    it('rejects a subdomain signer for a parent From domain and the reverse (relaxed is not implemented)', () => {
      const subdomainSigner = buildGateInput({
        validatedSignatures: [buildSignature({ signingDomain: 'mail.facebook.com' })],
      });
      const subdomainSender = buildGateInput({ fromAddress: 'security@mail.facebook.com' });

      expect(rejectionOf(subdomainSigner)).toBe('DOMAIN_NOT_ALIGNED');
      expect(rejectionOf(subdomainSender)).toBe('DOMAIN_NOT_ALIGNED');
    });

    it('rejects a signer that merely contains or extends the sender domain', () => {
      for (const signingDomain of [
        'facebook.com.evil.example',
        'notfacebook.com',
        'facebook.com.',
      ]) {
        const input = buildGateInput({
          validatedSignatures: [buildSignature({ signingDomain })],
        });
        expect(rejectionOf(input)).toBe('DOMAIN_NOT_ALIGNED');
      }
    });

    it('compares the signer domain case-insensitively but never folds Unicode', () => {
      const upperCase = buildGateInput({
        validatedSignatures: [buildSignature({ signingDomain: 'FACEBOOK.com' })],
      });
      // Signo Kelvin (U+212A): toLowerCase() lo pliega a "k", así que "faceboo\u212A.com" pasaría a ser
      // "facebook.com". Es la ÚNICA diferencia con el dominio del `From`: si el código plegara Unicode,
      // la alineación se cumpliría y esta prueba fallaría.
      const kelvinSigner = buildGateInput({
        fromAddress: 'security@facebook.com',
        validatedSignatures: [buildSignature({ signingDomain: 'faceboo\u212A.com' })],
      });

      expect(rejectionOf(upperCase)).toBeNull();
      expect(rejectionOf(kelvinSigner)).toBe('DOMAIN_NOT_ALIGNED');
    });
  });

  describe('signature requirements', () => {
    it('rejects when there is no validated signature', () => {
      expect(rejectionOf(buildGateInput({ validatedSignatures: [] }))).toBe('NO_VALID_SIGNATURE');
    });

    it('rejects a signature that carries l= (body length limit)', () => {
      const input = buildGateInput({
        validatedSignatures: [buildSignature({ hasBodyLengthLimit: true })],
      });
      expect(rejectionOf(input)).toBe('BODY_LENGTH_LIMIT_PRESENT');
    });

    it('rejects keys below 2048 bits, including non-numeric sizes', () => {
      for (const keyBits of [1024, 2047, 0, Number.NaN]) {
        const input = buildGateInput({ validatedSignatures: [buildSignature({ keyBits })] });
        expect(rejectionOf(input)).toBe('WEAK_KEY');
      }
      const strongKey = buildGateInput({
        validatedSignatures: [buildSignature({ keyBits: 4096 })],
      });
      expect(rejectionOf(strongKey)).toBeNull();
    });

    it('rejects an expired x= (also at the exact instant and with an invalid date)', () => {
      for (const expiresAt of [
        new Date(FIXTURE_NOW.getTime() - MILLISECONDS_PER_MINUTE),
        FIXTURE_NOW,
        new Date('not a date'),
      ]) {
        const input = buildGateInput({ validatedSignatures: [buildSignature({ expiresAt })] });
        expect(rejectionOf(input)).toBe('SIGNATURE_EXPIRED');
      }
    });

    it('accepts a signature without x= or t=', () => {
      const input = buildGateInput({
        validatedSignatures: [buildSignature({ expiresAt: null, signedAt: null })],
      });
      expect(rejectionOf(input)).toBeNull();
    });

    it('rejects a t= far in the future or invalid, and accepts one within tolerance', () => {
      const farFuture = new Date(FIXTURE_NOW.getTime() + 30 * MILLISECONDS_PER_MINUTE);
      const nearFuture = new Date(FIXTURE_NOW.getTime() + MILLISECONDS_PER_MINUTE);

      for (const signedAt of [farFuture, new Date('not a date')]) {
        const input = buildGateInput({ validatedSignatures: [buildSignature({ signedAt })] });
        expect(rejectionOf(input)).toBe('SIGNATURE_TIMESTAMP_INVALID');
      }
      const tolerated = buildGateInput({
        validatedSignatures: [buildSignature({ signedAt: nearFuture })],
      });
      expect(rejectionOf(tolerated)).toBeNull();
    });

    it('rejects an invalid clock instead of throwing', () => {
      const input = buildGateInput({ now: new Date('not a date') });
      expect(rejectionOf(input)).toBe('NO_VALID_SIGNATURE');
    });
  });

  describe('signed headers (h=)', () => {
    it('rejects when From is not oversigned: signed fewer times, or only as many as instances', () => {
      for (const from of [0, 1]) {
        const input = buildGateInput({
          validatedSignatures: [
            buildSignature({ signedHeaderCounts: { from, to: 1, subject: 2, date: 1 } }),
          ],
        });
        expect(rejectionOf(input)).toBe('FROM_NOT_OVERSIGNED');
      }
    });

    it('rejects when Subject is not oversigned', () => {
      for (const subject of [0, 1]) {
        const input = buildGateInput({
          validatedSignatures: [
            buildSignature({ signedHeaderCounts: { from: 2, to: 1, subject, date: 1 } }),
          ],
        });
        expect(rejectionOf(input)).toBe('SUBJECT_NOT_OVERSIGNED');
      }
    });

    it('rejects more than one From or more than one Subject, even when oversigned', () => {
      const duplicateFrom = buildGateInput({
        headerInstanceCounts: { from: 2, to: 1, subject: 1, date: 1 },
        validatedSignatures: [
          buildSignature({ signedHeaderCounts: { from: 3, to: 1, subject: 2, date: 1 } }),
        ],
      });
      const duplicateSubject = buildGateInput({
        headerInstanceCounts: { from: 1, to: 1, subject: 2, date: 1 },
        validatedSignatures: [
          buildSignature({ signedHeaderCounts: { from: 2, to: 1, subject: 3, date: 1 } }),
        ],
      });

      expect(rejectionOf(duplicateFrom)).toBe('DUPLICATE_FROM');
      expect(rejectionOf(duplicateSubject)).toBe('DUPLICATE_SUBJECT');
    });

    it('rejects a message without a From header', () => {
      const input = buildGateInput({
        headerInstanceCounts: { from: 0, to: 1, subject: 1, date: 1 },
      });
      expect(rejectionOf(input)).toBe('MISSING_FROM');
    });

    it('rejects when Date is not signed', () => {
      const input = buildGateInput({
        validatedSignatures: [
          buildSignature({ signedHeaderCounts: { from: 2, to: 1, subject: 2, date: 0 } }),
        ],
      });
      expect(rejectionOf(input)).toBe('DATE_NOT_SIGNED');
    });

    it('rejects when To is not signed', () => {
      const input = buildGateInput({
        validatedSignatures: [
          buildSignature({ signedHeaderCounts: { from: 2, to: 0, subject: 2, date: 1 } }),
        ],
      });
      expect(rejectionOf(input)).toBe('TO_NOT_SIGNED');
    });

    it('rejects an unsigned extra To or Date instance', () => {
      const extraTo = buildGateInput({
        headerInstanceCounts: { from: 1, to: 2, subject: 1, date: 1 },
        toAddresses: [FIXTURE_ALIAS],
      });
      const extraDate = buildGateInput({
        headerInstanceCounts: { from: 1, to: 1, subject: 1, date: 2 },
      });

      expect(rejectionOf(extraTo)).toBe('TO_NOT_SIGNED');
      expect(rejectionOf(extraDate)).toBe('DATE_NOT_SIGNED');
    });

    it('treats hostile counts (NaN, negative, fractional) as not signed', () => {
      for (const hostileCount of [Number.NaN, -1, 1.5]) {
        const input = buildGateInput({
          validatedSignatures: [
            buildSignature({
              signedHeaderCounts: { from: 2, to: hostileCount, subject: 2, date: 1 },
            }),
          ],
        });
        expect(rejectionOf(input)).toBe('TO_NOT_SIGNED');
      }
    });
  });

  describe('recipient', () => {
    it('rejects a header recipient that is not the source alias', () => {
      const input = buildGateInput({ toAddresses: ['otra-cuenta@alias.example.test'] });
      expect(rejectionOf(input)).toBe('RECIPIENT_MISMATCH');
    });

    it('rejects extra recipients, an empty recipient list and an alias that is a substring match', () => {
      const withExtraRecipient = buildGateInput({ toAddresses: [FIXTURE_ALIAS, 'otro@x.example'] });
      const withoutRecipient = buildGateInput({ toAddresses: [] });
      const superstring = buildGateInput({ toAddresses: [`x${FIXTURE_ALIAS}`] });

      expect(rejectionOf(withExtraRecipient)).toBe('RECIPIENT_MISMATCH');
      expect(rejectionOf(withoutRecipient)).toBe('RECIPIENT_MISMATCH');
      expect(rejectionOf(superstring)).toBe('RECIPIENT_MISMATCH');
    });

    it('compares the recipient case-insensitively', () => {
      const input = buildGateInput({ toAddresses: [FIXTURE_ALIAS.toUpperCase()] });
      expect(rejectionOf(input)).toBeNull();
    });
  });

  describe('From address', () => {
    it('rejects a missing, malformed or Unicode From address', () => {
      const hostileAddresses: (string | null)[] = [
        null,
        '',
        'sin-arroba',
        'dos@@facebook.com',
        '"x" <security@facebook.com>',
        'security@facebook.com,atacante@evil.example',
        // "а" cirílica (U+0430) en lugar de "a".
        'security@fаcebook.com',
      ];
      for (const fromAddress of hostileAddresses) {
        expect(rejectionOf(buildGateInput({ fromAddress }))).toBe('INVALID_FROM_ADDRESS');
      }
    });
  });

  describe('multiple signatures', () => {
    it('accepts when any validated signature complies, and ignores an unaligned extra one', () => {
      const input = buildGateInput({
        validatedSignatures: [buildSignature({ signingDomain: 'esp.example' }), buildSignature()],
      });
      expect(rejectionOf(input)).toBeNull();
    });

    it('rejects with the reason of the first signature when none complies', () => {
      const input = buildGateInput({
        validatedSignatures: [
          buildSignature({ hasBodyLengthLimit: true }),
          buildSignature({ keyBits: 1024 }),
        ],
      });
      expect(rejectionOf(input)).toBe('BODY_LENGTH_LIMIT_PRESENT');
    });
  });

  it('never throws on hostile structured data and always answers with an enumerated reason', () => {
    const hostile = buildGateInput({
      sourceAlias: '',
      fromAddress: 'x'.repeat(100_000),
      toAddresses: ['y'.repeat(100_000)],
      headerInstanceCounts: { from: Number.NaN, to: -5, subject: Infinity, date: 1.5 },
      validatedSignatures: [
        buildSignature({
          signingDomain: '\u0000',
          signedHeaderCounts: { from: Number.NaN, to: Number.NaN, subject: -1, date: -1 },
          keyBits: Number.NaN,
          expiresAt: new Date(Number.NaN),
          signedAt: new Date(Number.NaN),
        }),
      ],
    });

    const result = evaluateDkimGate(hostile);

    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(DKIM_REJECTION_REASONS).toContain(result.reason);
  });
});
