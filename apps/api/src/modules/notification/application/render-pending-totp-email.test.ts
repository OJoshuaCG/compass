import { describe, expect, it } from 'vitest';

import type { PendingTotpNoticeMessage } from './ports/mailer.js';
import { renderPendingTotpEmail } from './render-pending-totp-email.js';

const REGISTERED_AT = new Date('2026-03-04T15:30:00.000Z');
const BASE_MESSAGE: PendingTotpNoticeMessage = {
  to: 'luis@x.test',
  locale: 'es-MX',
  recipientDisplayName: 'Luis Operador',
  registeredAt: REGISTERED_AT,
};

describe('renderPendingTotpEmail', () => {
  it('is written in the recipient language, with its own subject', () => {
    const spanish = renderPendingTotpEmail(BASE_MESSAGE);
    const english = renderPendingTotpEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(spanish.subject).not.toBe(english.subject);
    expect(spanish.text).toContain('Hola, Luis Operador.');
    expect(spanish.text).toContain('más de 24 horas sin confirmarse');
    expect(english.text).toContain('Hello, Luis Operador.');
    expect(english.text).toContain('more than 24 hours');
  });

  it('states the registration moment in UTC', () => {
    const email = renderPendingTotpEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(email.text).toContain('2026');
    expect(email.text).toContain('UTC');
  });

  it('greets without a name when there is none or nothing visible is left after sanitizing', () => {
    const withoutName = renderPendingTotpEmail({ ...BASE_MESSAGE, recipientDisplayName: null });
    const onlyInvisible = renderPendingTotpEmail({
      ...BASE_MESSAGE,
      recipientDisplayName: '​‮\n',
    });

    expect(withoutName.text.startsWith('Hola.')).toBe(true);
    expect(onlyInvisible.text.startsWith('Hola.')).toBe(true);
  });

  it('sanitizes the name (control and bidi characters, length) and escapes it in the HTML', () => {
    const email = renderPendingTotpEmail({
      ...BASE_MESSAGE,
      recipientDisplayName: `<b>Luis</b>\r\n‮Bcc: x@evil.test ${'A'.repeat(200)}`,
    });

    expect(email.text).not.toContain('‮');
    expect(email.text.split('\n')[0]?.includes('\r')).toBe(false);
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('&#60;b&#62;Luis');
    // Saludo (6 + 80 + 2) como tope: el nombre no puede ocupar más de 80 caracteres.
    expect(email.text.split('\n')[0]?.length).toBeLessThanOrEqual('Hola, '.length + 80 + 1);
  });

  it('includes no link, no credential or account name and no secret material', () => {
    const email = renderPendingTotpEmail(BASE_MESSAGE);

    expect(email.text).not.toMatch(/https?:\/\//);
    expect(email.html).not.toMatch(/<a\s/);
    expect(email.text).not.toMatch(/otpauth|secret=/i);
  });
});
