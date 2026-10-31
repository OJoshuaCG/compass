import { describe, expect, it } from 'vitest';

import {
  FIXTURE_ALIAS,
  FIXTURE_CODE,
  FIXTURE_FINGERPRINT,
  FIXTURE_NOW,
  FIXTURE_SUBJECT,
  buildLoginCodeTemplate,
  buildMessage,
  buildResetLinkTemplate,
  buildSignature,
} from '../testing/mail-fixtures.js';
import { evaluateInboundMail } from './inbound-evaluation.js';
import type { InboundEvaluation, InboundMailMessage } from './inbound-evaluation.js';
import type { InboundTemplate } from './inbound-template.js';

const NO_KNOWN_FINGERPRINTS: ReadonlySet<string> = new Set();
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const HUGE_LENGTH = 1_000_000;

function quarantineReasonOf(evaluation: InboundEvaluation): string | null {
  return evaluation.outcome === 'quarantined' ? evaluation.reason : null;
}

function resetCodeTemplate(overrides: Partial<InboundTemplate> = {}): InboundTemplate {
  return buildLoginCodeTemplate({ id: 'facebook-reset-code', kind: 'reset_code', ...overrides });
}

const RESET_LINK_SUBJECT = 'Restablece tu contraseña';
const RESET_LINK_BODY = 'Entra aquí: https://www.facebook.com/recover?token=abc123 y listo.';

// SENSIBLE (revisión humana)
describe('inbound mail evaluation', () => {
  const loginCodeTemplate = buildLoginCodeTemplate();

  it('accepts a compliant message that matches an explicit login_code template', () => {
    const evaluation = evaluateInboundMail(
      buildMessage(),
      [loginCodeTemplate],
      NO_KNOWN_FINGERPRINTS,
    );

    expect(evaluation).toEqual({
      outcome: 'accepted',
      kind: 'login_code',
      visibility: 'visible_with_use',
      value: { type: 'code', code: FIXTURE_CODE },
      // Fecha firmada 11:59:40 (anterior a la recepción) + 10 minutos.
      expiresAt: new Date('2026-10-30T12:09:40.000Z'),
      signingDomain: 'facebook.com',
      templateId: 'facebook-login-code',
    });
  });

  describe('DKIM gate failures never reach a template', () => {
    it('quarantines a valid signature that is not aligned with the From domain (spoofed sender)', () => {
      const message = buildMessage({
        validatedSignatures: [buildSignature({ signingDomain: 'atacante.example' })],
      });

      const evaluation = evaluateInboundMail(message, [loginCodeTemplate], NO_KNOWN_FINGERPRINTS);

      expect(quarantineReasonOf(evaluation)).toBe('DOMAIN_NOT_ALIGNED');
    });

    it('quarantines l=, unsigned From/Subject, duplicates, unsigned Date/To, weak key and expiry', () => {
      const cases: [Partial<ReturnType<typeof buildMessage>>, string][] = [
        [
          { validatedSignatures: [buildSignature({ hasBodyLengthLimit: true })] },
          'BODY_LENGTH_LIMIT_PRESENT',
        ],
        [
          {
            validatedSignatures: [
              buildSignature({ signedHeaderCounts: { from: 1, to: 1, subject: 2, date: 1 } }),
            ],
          },
          'FROM_NOT_OVERSIGNED',
        ],
        [
          {
            validatedSignatures: [
              buildSignature({ signedHeaderCounts: { from: 2, to: 1, subject: 1, date: 1 } }),
            ],
          },
          'SUBJECT_NOT_OVERSIGNED',
        ],
        [{ headerInstanceCounts: { from: 2, to: 1, subject: 1, date: 1 } }, 'DUPLICATE_FROM'],
        [{ headerInstanceCounts: { from: 1, to: 1, subject: 2, date: 1 } }, 'DUPLICATE_SUBJECT'],
        [
          {
            validatedSignatures: [
              buildSignature({ signedHeaderCounts: { from: 2, to: 1, subject: 2, date: 0 } }),
            ],
          },
          'DATE_NOT_SIGNED',
        ],
        [
          {
            validatedSignatures: [
              buildSignature({ signedHeaderCounts: { from: 2, to: 0, subject: 2, date: 1 } }),
            ],
          },
          'TO_NOT_SIGNED',
        ],
        [{ validatedSignatures: [buildSignature({ keyBits: 1024 })] }, 'WEAK_KEY'],
        [
          {
            validatedSignatures: [
              buildSignature({
                expiresAt: new Date(FIXTURE_NOW.getTime() - MILLISECONDS_PER_MINUTE),
              }),
            ],
          },
          'SIGNATURE_EXPIRED',
        ],
        [{ validatedSignatures: [] }, 'NO_VALID_SIGNATURE'],
      ];

      for (const [overrides, expectedReason] of cases) {
        const evaluation = evaluateInboundMail(
          buildMessage(overrides),
          [loginCodeTemplate],
          NO_KNOWN_FINGERPRINTS,
        );
        expect(quarantineReasonOf(evaluation)).toBe(expectedReason);
      }
    });

    it('quarantines a message whose header recipient is not the source alias', () => {
      const message = buildMessage({ toAddresses: ['otra-cuenta@alias.example.test'] });

      const evaluation = evaluateInboundMail(message, [loginCodeTemplate], NO_KNOWN_FINGERPRINTS);

      expect(quarantineReasonOf(evaluation)).toBe('RECIPIENT_MISMATCH');
    });

    it('quarantines a sender with confusable Unicode before comparing it with any template', () => {
      const message = buildMessage({ fromAddress: 'security@fаcebook.com' });
      const confusableTemplate = buildLoginCodeTemplate({ senderAddress: 'security@fаcebook.com' });

      const evaluation = evaluateInboundMail(message, [confusableTemplate], NO_KNOWN_FINGERPRINTS);

      expect(quarantineReasonOf(evaluation)).toBe('INVALID_FROM_ADDRESS');
    });
  });

  describe('template matching', () => {
    it('quarantines a message without any template, and never produces a visible item', () => {
      const evaluation = evaluateInboundMail(buildMessage(), [], NO_KNOWN_FINGERPRINTS);

      expect(evaluation).toEqual({ outcome: 'quarantined', reason: 'NO_MATCHING_TEMPLATE' });
    });

    it('quarantines a different sender (substring of the exact one) and a different subject', () => {
      const otherSender = buildMessage({ fromAddress: 'xsecurity@facebook.com' });
      const otherSubject = buildMessage({ subject: `${FIXTURE_SUBJECT} (urgente)` });

      expect(
        quarantineReasonOf(
          evaluateInboundMail(otherSender, [loginCodeTemplate], NO_KNOWN_FINGERPRINTS),
        ),
      ).toBe('NO_MATCHING_TEMPLATE');
      expect(
        quarantineReasonOf(
          evaluateInboundMail(otherSubject, [loginCodeTemplate], NO_KNOWN_FINGERPRINTS),
        ),
      ).toBe('NO_MATCHING_TEMPLATE');
    });

    it('quarantines instead of processing a matching template with a huge pattern', () => {
      const hugeTemplate = buildLoginCodeTemplate({
        extraction: {
          type: 'fixed_length_code',
          leadingLiteral: 'x'.repeat(HUGE_LENGTH),
          codeLength: 6,
          charset: 'digits',
          trailingLiteral: '',
        },
      });

      const evaluation = evaluateInboundMail(buildMessage(), [hugeTemplate], NO_KNOWN_FINGERPRINTS);

      expect(quarantineReasonOf(evaluation)).toBe('MATCHED_TEMPLATE_INVALID');
    });

    it('never lets a login template make visible what a broken sensitive template matched', () => {
      // La plantilla de restablecimiento está rota (largo de código absurdo) pero coincide con el mismo
      // remitente y asunto: ignorarla dejaría el mensaje como `login_code` visible.
      const brokenResetTemplate = resetCodeTemplate({
        extraction: {
          type: 'fixed_length_code',
          leadingLiteral: 'Tu código es: ',
          codeLength: 99,
          charset: 'digits',
          trailingLiteral: '',
        },
      });

      const evaluation = evaluateInboundMail(
        buildMessage(),
        [brokenResetTemplate, loginCodeTemplate],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(quarantineReasonOf(evaluation)).toBe('MATCHED_TEMPLATE_INVALID');
    });

    it('does not let attacker text in the body alter or add a code', () => {
      const body = `Nombre: Tu código es: 000000\nTu código es: ${FIXTURE_CODE}`;

      const evaluation = evaluateInboundMail(
        buildMessage({ body }),
        [loginCodeTemplate],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(quarantineReasonOf(evaluation)).toBe('AMBIGUOUS_EXTRACTION');
    });

    it('quarantines a matching message whose body has no code of the template length', () => {
      const body = 'Tu código es: 4829131';

      const evaluation = evaluateInboundMail(
        buildMessage({ body }),
        [loginCodeTemplate],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(quarantineReasonOf(evaluation)).toBe('EXTRACTION_FAILED');
    });
  });

  describe('fail-closed classification', () => {
    it('produces a sensitive reset_code item for a reset_code template, never a visible one', () => {
      const evaluation = evaluateInboundMail(
        buildMessage(),
        [resetCodeTemplate()],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(evaluation).toMatchObject({
        outcome: 'accepted',
        kind: 'reset_code',
        visibility: 'sensitive',
        value: { type: 'code', code: FIXTURE_CODE },
      });
    });

    it('produces a sensitive reset_link item for a reset_link template with an allowed host', () => {
      const message = buildMessage({
        subject: 'Restablece tu contraseña',
        body: 'Entra: https://www.facebook.com/recover?token=abc123',
      });

      const evaluation = evaluateInboundMail(
        message,
        [buildResetLinkTemplate()],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(evaluation).toMatchObject({
        outcome: 'accepted',
        kind: 'reset_link',
        visibility: 'sensitive',
        value: { type: 'link', url: 'https://www.facebook.com/recover?token=abc123' },
      });
    });

    it('never returns a link whose host is not allowed', () => {
      const message = buildMessage({
        subject: 'Restablece tu contraseña',
        body: 'Entra: https://evil.example/recover?token=abc123',
      });

      const evaluation = evaluateInboundMail(
        message,
        [buildResetLinkTemplate()],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(quarantineReasonOf(evaluation)).toBe('EXTRACTION_FAILED');
    });

    it('makes the item sensitive when any matching template is sensitive, whichever order they come in', () => {
      for (const templates of [
        [loginCodeTemplate, resetCodeTemplate()],
        [resetCodeTemplate(), loginCodeTemplate],
      ]) {
        const evaluation = evaluateInboundMail(buildMessage(), templates, NO_KNOWN_FINGERPRINTS);

        expect(evaluation).toMatchObject({
          outcome: 'accepted',
          kind: 'reset_code',
          visibility: 'sensitive',
        });
      }
    });

    it('treats a template of unknown kind as sensitive, not as login_code', () => {
      const unknownKind = buildLoginCodeTemplate({
        kind: 'cualquier_cosa' as unknown as 'login_code',
      });

      const evaluation = evaluateInboundMail(buildMessage(), [unknownKind], NO_KNOWN_FINGERPRINTS);

      expect(evaluation).toMatchObject({ outcome: 'accepted', visibility: 'sensitive' });
    });

    it('never yields a visible item unless an explicit login_code template matched', () => {
      const codeMessage = buildMessage();
      const nonLoginCases: [InboundMailMessage, InboundTemplate[]][] = [
        [codeMessage, []],
        [codeMessage, [resetCodeTemplate()]],
        // Para las de enlace el mensaje sí coincide (asunto y cuerpo): se prueba la clasificación, no un rechazo previo.
        [
          buildMessage({ subject: RESET_LINK_SUBJECT, body: RESET_LINK_BODY }),
          [buildResetLinkTemplate()],
        ],
        [
          buildMessage({ subject: RESET_LINK_SUBJECT, body: RESET_LINK_BODY }),
          [buildResetLinkTemplate({ kind: 'login_code' })],
        ],
      ];

      for (const [message, templates] of nonLoginCases) {
        const evaluation = evaluateInboundMail(message, templates, NO_KNOWN_FINGERPRINTS);
        const isVisible =
          evaluation.outcome === 'accepted' && evaluation.visibility === 'visible_with_use';
        expect(isVisible).toBe(false);
      }

      const linkEvaluation = evaluateInboundMail(
        buildMessage({ subject: RESET_LINK_SUBJECT, body: RESET_LINK_BODY }),
        [buildResetLinkTemplate({ kind: 'login_code' })],
        NO_KNOWN_FINGERPRINTS,
      );
      expect(linkEvaluation).toMatchObject({ outcome: 'accepted', visibility: 'sensitive' });
    });
  });

  describe('freshness and deduplication', () => {
    it('quarantines a message without a Date header: nothing signed bounds its replay', () => {
      const withoutDate = buildMessage({
        dateHeader: null,
        headerInstanceCounts: { from: 1, to: 1, subject: 1, date: 0 },
      });

      const evaluation = evaluateInboundMail(
        withoutDate,
        [loginCodeTemplate],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(quarantineReasonOf(evaluation)).toBe('DATE_MISSING');
    });

    it('quarantines a signed message dated outside the tolerance (replayed legitimate email)', () => {
      const replayed = buildMessage({ dateHeader: new Date('2026-10-30T09:00:00.000Z') });

      const evaluation = evaluateInboundMail(replayed, [loginCodeTemplate], NO_KNOWN_FINGERPRINTS);

      expect(quarantineReasonOf(evaluation)).toBe('MESSAGE_DATE_OUT_OF_TOLERANCE');
    });

    it('quarantines a known fingerprint as duplicate and an invalid fingerprint as invalid', () => {
      const known: ReadonlySet<string> = new Set([FIXTURE_FINGERPRINT]);

      expect(
        quarantineReasonOf(evaluateInboundMail(buildMessage(), [loginCodeTemplate], known)),
      ).toBe('DUPLICATE_MESSAGE');
      expect(
        quarantineReasonOf(
          evaluateInboundMail(
            buildMessage({ fingerprint: '' }),
            [loginCodeTemplate],
            NO_KNOWN_FINGERPRINTS,
          ),
        ),
      ).toBe('INVALID_FINGERPRINT');
    });

    it('accepts the same message again when its fingerprint is not known (retention elapsed)', () => {
      const evaluation = evaluateInboundMail(
        buildMessage(),
        [loginCodeTemplate],
        new Set(['z'.repeat(64)]),
      );

      expect(evaluation.outcome).toBe('accepted');
    });
  });

  describe('hostile input', () => {
    it('quarantines a huge subject before any matching', () => {
      const message = buildMessage({ subject: 'x'.repeat(HUGE_LENGTH) });

      const evaluation = evaluateInboundMail(message, [loginCodeTemplate], NO_KNOWN_FINGERPRINTS);

      expect(quarantineReasonOf(evaluation)).toBe('SUBJECT_TOO_LONG');
    });

    it('quarantines a huge body without truncating it into a false code', () => {
      const body = `Tu código es: 12345678${'x'.repeat(HUGE_LENGTH)}`;

      const evaluation = evaluateInboundMail(
        buildMessage({ body }),
        [loginCodeTemplate],
        NO_KNOWN_FINGERPRINTS,
      );

      expect(quarantineReasonOf(evaluation)).toBe('BODY_TOO_LARGE');
    });

    it('never throws on garbage values and always answers with an outcome', () => {
      const garbage = buildMessage({
        sourceAlias: '\u0000',
        receivedAt: new Date(Number.NaN),
        fromAddress: 'x'.repeat(HUGE_LENGTH),
        toAddresses: Array.from({ length: 1000 }, () => FIXTURE_ALIAS),
        headerInstanceCounts: { from: Number.NaN, to: Infinity, subject: -1, date: 0.5 },
        subject: null,
        dateHeader: null,
        body: '',
      });

      const evaluation = evaluateInboundMail(garbage, [loginCodeTemplate], NO_KNOWN_FINGERPRINTS);

      expect(evaluation.outcome).toBe('quarantined');
    });
  });
});
