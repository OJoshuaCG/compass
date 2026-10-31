import { describe, expect, it } from 'vitest';

import type { SecurityNoticeKind } from './ports/mailer.js';
import { renderSecurityNoticeEmail } from './render-security-notice-email.js';

const OCCURRED_AT = new Date('2026-03-04T15:30:00.000Z');
const KINDS: readonly SecurityNoticeKind[] = [
  'recovery_code_used',
  'passkey_added',
  'passkey_removed',
  'totp_removed',
];

describe('renderSecurityNoticeEmail', () => {
  it.each(KINDS)('renders %s in both languages with its own subject', (kind) => {
    const spanish = renderSecurityNoticeEmail({
      to: 'a@x.test',
      locale: 'es-MX',
      kind,
      occurredAt: OCCURRED_AT,
    });
    const english = renderSecurityNoticeEmail({
      to: 'a@x.test',
      locale: 'en-US',
      kind,
      occurredAt: OCCURRED_AT,
    });

    expect(spanish.subject).not.toBe(english.subject);
    expect(spanish.text).toContain('Si no lo reconoces');
    expect(english.text).toContain('do not recognize');
  });

  it('gives a different subject to each kind of change', () => {
    const subjects = KINDS.map(
      (kind) =>
        renderSecurityNoticeEmail({
          to: 'a@x.test',
          locale: 'en-US',
          kind,
          occurredAt: OCCURRED_AT,
        }).subject,
    );

    expect(new Set(subjects).size).toBe(KINDS.length);
  });

  it('states the moment in UTC and carries no links nor the recipient address', () => {
    const email = renderSecurityNoticeEmail({
      to: 'secret.person@x.test',
      locale: 'en-US',
      kind: 'passkey_added',
      occurredAt: OCCURRED_AT,
    });

    expect(email.text).toContain('UTC');
    expect(email.text).toContain('3:30 PM');
    for (const body of [email.subject, email.text, email.html]) {
      expect(body).not.toMatch(/https?:\/\//i);
      expect(body).not.toContain('secret.person');
    }
  });

  it('describes the authenticator removal without codes, secrets or links, and escapes the html', () => {
    for (const locale of ['es-MX', 'en-US'] as const) {
      const email = renderSecurityNoticeEmail({
        to: 'a@x.test',
        locale,
        kind: 'totp_removed',
        occurredAt: OCCURRED_AT,
      });

      for (const body of [email.subject, email.text, email.html]) {
        expect(body).not.toMatch(/https?:\/\//i);
        expect(body).not.toMatch(/\d{6}/);
      }
      // Cada línea va en su propio párrafo y ningún texto introduce etiquetas por su cuenta.
      expect(email.html.replace(/<\/?p>/g, '')).not.toMatch(/[<>]/);
    }
  });
});
