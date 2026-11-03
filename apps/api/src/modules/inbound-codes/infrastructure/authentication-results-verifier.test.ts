import { describe, expect, it } from 'vitest';

import type { MailHeader } from '../application/ports/mime-and-authenticity.js';
import { buildParsedMail } from '../testing/poll-fakes.js';
import { AuthenticationResultsVerifier } from './authentication-results-verifier.js';

const AUTHSERV_ID = 'mx.inbound.example.test';
const FROM_ADDRESS = 'security@facebook.com';
const SIGNATURE_PREFIX = 'AbCdEf12';

const OWN_RESULTS =
  `${AUTHSERV_ID}; spf=pass smtp.mailfrom=facebook.com; ` +
  `dkim=pass header.d=facebook.com header.s=s1 header.b=${SIGNATURE_PREFIX}; dmarc=pass header.from=facebook.com`;

const VALID_SIGNATURE =
  'v=1; a=rsa-sha256; d=facebook.com; s=s1; h=from:from:to:subject:subject:date; ' +
  `bh=xyz; b=${SIGNATURE_PREFIX}ghIJKL\r\n mnop; t=1793361570; x=1793365200`;

function header(name: string, value: string, position: number): MailHeader {
  return { name, value, position };
}

function assess(headers: readonly MailHeader[], fromAddress: string | null = FROM_ADDRESS) {
  const mail = buildParsedMail({ relevantHeaders: headers });
  return new AuthenticationResultsVerifier().assess(mail, { authservId: AUTHSERV_ID, fromAddress });
}

describe('AuthenticationResultsVerifier', () => {
  it('returns the single aligned signature with the key size marked as not available', () => {
    const result = assess([
      header('authentication-results', OWN_RESULTS, 0),
      header('dkim-signature', VALID_SIGNATURE, 5),
    ]);

    if (!result.ok) throw new Error('expected an assessment');
    expect(result.verdicts).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
    expect(result.validatedSignatures).toEqual([
      {
        signingDomain: 'facebook.com',
        signedHeaderCounts: { from: 2, to: 1, subject: 2, date: 1 },
        hasBodyLengthLimit: false,
        signedAt: new Date(1793361570 * 1000),
        expiresAt: new Date(1793365200 * 1000),
        keyBits: 0,
        keyBitsPolicy: 'not_available',
      },
    ]);
  });

  describe('Authentication-Results of the own server', () => {
    it('rejects when there is none', () => {
      expect(assess([header('dkim-signature', VALID_SIGNATURE, 0)])).toEqual({
        ok: false,
        reason: 'AUTH_RESULTS_AMBIGUOUS',
      });
    });

    it('rejects a header written by another server even if it is well formed', () => {
      const foreign = OWN_RESULTS.replace(AUTHSERV_ID, 'mx.attacker.example.test');
      expect(
        assess([
          header('authentication-results', foreign, 0),
          header('dkim-signature', VALID_SIGNATURE, 1),
        ]),
      ).toEqual({ ok: false, reason: 'AUTH_RESULTS_AMBIGUOUS' });
    });

    it('rejects two headers carrying the own authserv-id', () => {
      expect(
        assess([
          header('authentication-results', OWN_RESULTS, 0),
          header('authentication-results', OWN_RESULTS, 1),
          header('dkim-signature', VALID_SIGNATURE, 2),
        ]),
      ).toEqual({ ok: false, reason: 'AUTH_RESULTS_AMBIGUOUS' });
    });

    it('rejects the own header when it is not the first one of the message', () => {
      expect(
        assess([
          header('authentication-results', OWN_RESULTS, 1),
          header('dkim-signature', VALID_SIGNATURE, 2),
        ]),
      ).toEqual({ ok: false, reason: 'AUTH_RESULTS_AMBIGUOUS' });
    });

    it('compares the authserv-id ignoring case and an optional version, and ignores comments', () => {
      const withVersion = OWN_RESULTS.replace(
        AUTHSERV_ID,
        `${AUTHSERV_ID.toUpperCase()} 1 (comentario; dkim=pass header.d=facebook.com)`,
      );
      const result = assess([
        header('authentication-results', withVersion, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result.ok).toBe(true);
    });

    it('does not read a result written inside a comment', () => {
      const commented = `${AUTHSERV_ID}; spf=pass (dkim=pass header.d=facebook.com header.s=s1 header.b=${SIGNATURE_PREFIX}); dkim=fail header.d=facebook.com`;
      const result = assess([
        header('authentication-results', commented, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toMatchObject({ ok: true, validatedSignatures: [] });
    });

    it('does not accept the header when a quote or a comment is left open', () => {
      for (const broken of [
        `${OWN_RESULTS}; reason="sin cerrar`,
        `${OWN_RESULTS}; spf=pass (sin cerrar`,
      ]) {
        expect(
          assess([
            header('authentication-results', broken, 0),
            header('dkim-signature', VALID_SIGNATURE, 1),
          ]),
        ).toEqual({ ok: false, reason: 'AUTH_RESULTS_AMBIGUOUS' });
      }
    });

    it('accepts a foreign authserv-id header next to the own one at position 0', () => {
      const foreign = OWN_RESULTS.replace(AUTHSERV_ID, 'mx.otro.example.test');
      const result = assess([
        header('authentication-results', OWN_RESULTS, 0),
        header('authentication-results', foreign, 1),
        header('dkim-signature', VALID_SIGNATURE, 2),
      ]);
      expect(result.ok).toBe(true);
    });

    it('does not let a prefix of the authserv-id pass as the configured one', () => {
      const prefixOnly = OWN_RESULTS.replace(AUTHSERV_ID, `${AUTHSERV_ID}.attacker.test`);
      expect(
        assess([
          header('authentication-results', prefixOnly, 0),
          header('dkim-signature', VALID_SIGNATURE, 1),
        ]),
      ).toEqual({ ok: false, reason: 'AUTH_RESULTS_AMBIGUOUS' });
    });
  });

  describe('quoted strings written by the sender', () => {
    const FORGED_PASS = `dkim=pass header.d=facebook.com header.s=s1 header.b=${SIGNATURE_PREFIX}`;

    it('does not read a result injected through a quoted value that holds a semicolon', () => {
      const injected =
        `${AUTHSERV_ID}; spf=pass smtp.mailfrom="x;${FORGED_PASS}"@evil.test; ` +
        'dkim=fail header.d=evil.test';
      const result = assess([
        header('authentication-results', injected, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toMatchObject({ ok: true, validatedSignatures: [] });
    });

    it('does not read a property injected through a quoted value that holds spaces', () => {
      const injected =
        `${AUTHSERV_ID}; dkim=pass header.i="a header.d=facebook.com header.s=s1 header.b=${SIGNATURE_PREFIX}" ` +
        'header.d=evil.test header.s=s1 header.b=ZZZZZZZZ';
      const result = assess([
        header('authentication-results', injected, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toMatchObject({ ok: true, validatedSignatures: [] });
    });

    it('does not let a parenthesis inside quotes swallow the rest of the header', () => {
      const withParenthesis = `${AUTHSERV_ID}; spf=pass reason="abre ( sin cerrar"; ${FORGED_PASS}; ${FORGED_PASS.replace('s1', 's2')}`;
      const result = assess([
        header('authentication-results', withParenthesis, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
    });

    it('keeps the value of a quoted property whole', () => {
      const quoted = OWN_RESULTS.replace('header.s=s1', 'header.s="s1"');
      const result = assess([
        header('authentication-results', quoted, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toMatchObject({
        ok: true,
        validatedSignatures: [{ signingDomain: 'facebook.com' }],
      });
    });
  });

  describe('signature selection', () => {
    it('returns no signature when dkim did not pass', () => {
      const failed = OWN_RESULTS.replace('dkim=pass', 'dkim=fail');
      const result = assess([
        header('authentication-results', failed, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toMatchObject({ ok: true, validatedSignatures: [] });
    });

    it('returns no signature when the passing domain is not the From domain', () => {
      const result = assess(
        [
          header('authentication-results', OWN_RESULTS, 0),
          header('dkim-signature', VALID_SIGNATURE, 1),
        ],
        'security@otra.example.test',
      );
      expect(result).toMatchObject({ ok: true, validatedSignatures: [] });
    });

    it('returns no signature when the message has no usable From', () => {
      const result = assess(
        [
          header('authentication-results', OWN_RESULTS, 0),
          header('dkim-signature', VALID_SIGNATURE, 1),
        ],
        null,
      );
      expect(result).toMatchObject({ ok: true, validatedSignatures: [] });
    });

    it('ignores a header.d on a method that is not dkim', () => {
      const spfOnly = `${AUTHSERV_ID}; spf=pass header.d=facebook.com header.s=s1 header.b=${SIGNATURE_PREFIX}`;
      const result = assess([
        header('authentication-results', spfOnly, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toMatchObject({ ok: true, validatedSignatures: [] });
    });

    it('keeps the first value of a repeated property', () => {
      const repeated = OWN_RESULTS.replace(
        'header.d=facebook.com',
        'header.d=facebook.com header.d=evil.test',
      );
      const result = assess([
        header('authentication-results', repeated, 0),
        header('dkim-signature', VALID_SIGNATURE, 1),
      ]);
      expect(result).toMatchObject({
        ok: true,
        validatedSignatures: [{ signingDomain: 'facebook.com' }],
      });
    });

    it('does not take a signature that matches only the b= prefix', () => {
      for (const decoy of [
        VALID_SIGNATURE.replace('s=s1', 's=s9'),
        VALID_SIGNATURE.replace('d=facebook.com', 'd=evil.test'),
      ]) {
        expect(
          assess([
            header('authentication-results', OWN_RESULTS, 0),
            header('dkim-signature', decoy, 1),
          ]),
        ).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
      }
    });

    it('requires the b= prefix to be at the start of the signature value, not just contained', () => {
      const shifted = VALID_SIGNATURE.replace(`b=${SIGNATURE_PREFIX}`, `b=QQ${SIGNATURE_PREFIX}`);
      expect(
        assess([
          header('authentication-results', OWN_RESULTS, 0),
          header('dkim-signature', shifted, 1),
        ]),
      ).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
    });

    it('requires a b= prefix of at least six base64 characters', () => {
      const withPrefix = (prefix: string) =>
        assess([
          header('authentication-results', OWN_RESULTS.replace(SIGNATURE_PREFIX, prefix), 0),
          header('dkim-signature', VALID_SIGNATURE.replace(SIGNATURE_PREFIX, prefix), 1),
        ]);
      expect(withPrefix('AbCdE')).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
      expect(withPrefix('AbCdEf').ok).toBe(true);
      expect(withPrefix('AbC!Ef12')).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
    });

    it('matches a b= whose first characters are split by folding whitespace', () => {
      const folded = VALID_SIGNATURE.replace(`b=${SIGNATURE_PREFIX}`, 'b=AbCd\r\n\tEf12');
      const result = assess([
        header('authentication-results', OWN_RESULTS, 0),
        header('dkim-signature', folded, 1),
      ]);
      expect(result.ok).toBe(true);
    });

    it('compares the From domain, header.d and d= ignoring case', () => {
      const upper = OWN_RESULTS.replace('header.d=facebook.com', 'header.d=Facebook.COM');
      const result = assess(
        [
          header('authentication-results', upper, 0),
          header('dkim-signature', VALID_SIGNATURE.replace('d=facebook.com', 'd=FACEBOOK.com'), 1),
        ],
        'Security@Facebook.com',
      );
      expect(result.ok).toBe(true);
    });

    it('is ambiguous when two signatures share d=, s= and the b= prefix', () => {
      expect(
        assess([
          header('authentication-results', OWN_RESULTS, 0),
          header('dkim-signature', VALID_SIGNATURE, 1),
          header('dkim-signature', VALID_SIGNATURE, 2),
        ]),
      ).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
    });

    it('picks the signature by b= prefix when a forged one shares d= and s=', () => {
      const forged = VALID_SIGNATURE.replace(SIGNATURE_PREFIX, 'ZZZZZZZZ').replace(
        'd=facebook.com;',
        'd=facebook.com; l=5;',
      );
      const result = assess([
        header('authentication-results', OWN_RESULTS, 0),
        header('dkim-signature', forged, 1),
        header('dkim-signature', VALID_SIGNATURE, 2),
      ]);
      if (!result.ok) throw new Error('expected an assessment');
      expect(result.validatedSignatures).toHaveLength(1);
      expect(result.validatedSignatures[0]?.hasBodyLengthLimit).toBe(false);
    });

    it('is ambiguous when the verdict names no signature present in the message', () => {
      expect(assess([header('authentication-results', OWN_RESULTS, 0)])).toEqual({
        ok: false,
        reason: 'DKIM_SIGNATURE_AMBIGUOUS',
      });
    });

    it('is ambiguous when the verdict carries no usable header.b', () => {
      const noPrefix = OWN_RESULTS.replace(` header.b=${SIGNATURE_PREFIX}`, '');
      expect(
        assess([
          header('authentication-results', noPrefix, 0),
          header('dkim-signature', VALID_SIGNATURE, 1),
        ]),
      ).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
    });

    it('is ambiguous when two aligned results pass', () => {
      const twoPasses = `${OWN_RESULTS}; dkim=pass header.d=facebook.com header.s=s2 header.b=QrStUv34`;
      expect(
        assess([
          header('authentication-results', twoPasses, 0),
          header('dkim-signature', VALID_SIGNATURE, 1),
        ]),
      ).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
    });

    it('is ambiguous when a signature repeats a tag', () => {
      const repeated = `${VALID_SIGNATURE}; l=10`.replace('v=1;', 'v=1; l=20;');
      expect(
        assess([
          header('authentication-results', OWN_RESULTS, 0),
          header('dkim-signature', repeated, 1),
        ]),
      ).toEqual({ ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' });
    });
  });

  describe('signature evidence', () => {
    function evidenceOf(signature: string) {
      const result = assess([
        header('authentication-results', OWN_RESULTS, 0),
        header('dkim-signature', signature, 1),
      ]);
      if (!result.ok) throw new Error('expected an assessment');
      const [evidence] = result.validatedSignatures;
      if (evidence === undefined) throw new Error('expected a signature');
      return evidence;
    }

    it('reports l= whenever the tag is present, whatever its value', () => {
      expect(evidenceOf(`${VALID_SIGNATURE}; l=0`).hasBodyLengthLimit).toBe(true);
    });

    it('counts each repetition of a header in h= to detect over-signing', () => {
      const evidence = evidenceOf(
        VALID_SIGNATURE.replace('h=from:from:to:subject:subject:date', 'h=From:to:Subject:DATE'),
      );
      expect(evidence.signedHeaderCounts).toEqual({ from: 1, to: 1, subject: 1, date: 1 });
    });

    it('reads an unreadable x= as already expired instead of as no expiry', () => {
      const evidence = evidenceOf(VALID_SIGNATURE.replace('x=1793365200', 'x=manana'));
      expect(evidence.expiresAt).toEqual(new Date(0));
    });

    it('reads an unreadable t= as the epoch so the gate can reject it', () => {
      const evidence = evidenceOf(VALID_SIGNATURE.replace('t=1793361570', 't=ayer'));
      expect(evidence.signedAt).toEqual(new Date(0));
    });

    it('leaves t= and x= empty when the signature does not carry them', () => {
      const evidence = evidenceOf(VALID_SIGNATURE.replace('; t=1793361570; x=1793365200', ''));
      expect(evidence.signedAt).toBeNull();
      expect(evidence.expiresAt).toBeNull();
    });
  });

  describe('verdicts for the phase 2 log', () => {
    it('bounds the verdicts to short lowercase words', () => {
      const hostile = `${AUTHSERV_ID}; spf=${'x'.repeat(40)}; dkim=pass\u0000evil header.d=otra.test; dmarc=PASS`;
      const result = assess([header('authentication-results', hostile, 0)]);
      if (!result.ok) throw new Error('expected an assessment');
      expect(result.verdicts.spf).toBeNull();
      expect(result.verdicts.dkim).toBeNull();
      expect(result.verdicts.dmarc).toBe('pass');
    });

    it('reports pass when any result of a method passed', () => {
      const mixed = `${AUTHSERV_ID}; dkim=fail header.d=a.test; dkim=pass header.d=b.test`;
      const result = assess([header('authentication-results', mixed, 0)]);
      if (!result.ok) throw new Error('expected an assessment');
      expect(result.verdicts.dkim).toBe('pass');
    });
  });
});
