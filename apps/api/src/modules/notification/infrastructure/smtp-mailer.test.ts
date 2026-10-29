import { describe, expect, it, vi } from 'vitest';

import { renderInvitationEmail } from '../application/render-invitation-email.js';
import { SmtpMailer } from './smtp-mailer.js';
import type { MailTransport, SmtpOptions } from './smtp-mailer.js';

const options: SmtpOptions = {
  host: 'mail.example.com',
  port: 587,
  security: 'starttls',
  user: 'no-reply@example.com',
  password: 'secret-value',
  from: 'IAM <no-reply@example.com>',
  baseUrl: 'https://iam.example.com',
};
const message = {
  to: 'guest@example.com',
  token: 'tok+/=secret',
  expiresAt: new Date('2026-11-01T15:30:00Z'),
  locale: 'es-MX' as const,
};

describe('renderInvitationEmail', () => {
  it('puts the token only in the link fragment, encoded, in both text and HTML', () => {
    const email = renderInvitationEmail(message, options.baseUrl);
    const link = 'https://iam.example.com/invitation#token=tok%2B%2F%3Dsecret';
    expect(email.text).toContain(link);
    expect(email.html).toContain(link);
    expect(email.subject).not.toContain('tok');
  });

  it('is written in the recipient language and states the UTC expiry', () => {
    const es = renderInvitationEmail(message, options.baseUrl);
    const en = renderInvitationEmail({ ...message, locale: 'en-US' }, options.baseUrl);
    expect(es.subject).toBe('Te invitaron a la plataforma');
    expect(en.subject).toBe('You have been invited to the platform');
    expect(es.text).toContain('UTC');
    expect(en.text).toContain('2026');
  });

  it('escapes anything that goes into the HTML body', () => {
    const email = renderInvitationEmail(
      { ...message, token: '"><script>x</script>' },
      options.baseUrl,
    );
    expect(email.html).not.toContain('<script>');
  });
});

describe('SmtpMailer', () => {
  it('sends the rendered message from the configured sender to the guest', async () => {
    const sendMail = vi.fn<MailTransport['sendMail']>().mockResolvedValue(undefined);
    await new SmtpMailer(options, 'production', { sendMail }).sendInvitation(message);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: 'IAM <no-reply@example.com>',
      to: 'guest@example.com',
      subject: 'Te invitaron a la plataforma',
    });
  });

  it('hides the provider error: it may quote the recipient or the token', async () => {
    const sendMail = vi
      .fn<MailTransport['sendMail']>()
      .mockRejectedValue(new Error('550 rejected guest@example.com body tok+/=secret'));
    const failure = await new SmtpMailer(options, 'production', { sendMail })
      .sendInvitation(message)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toBe('Error: Mail delivery failed');
    expect((failure as Error).cause).toBeUndefined();
  });

  it('sends the reveal limit alert to the Root and hides the provider error', async () => {
    const alert = {
      to: 'root@example.com',
      locale: 'en-US' as const,
      actorDisplayName: 'Sofia',
      limitPerHour: 30,
      revealedInWindow: 30,
      windowMinutes: 60,
      occurredAt: new Date('2026-03-04T15:30:00Z'),
    };
    const sendMail = vi.fn<MailTransport['sendMail']>().mockResolvedValue(undefined);
    await new SmtpMailer(options, 'production', { sendMail }).sendRevealLimitAlert(alert);

    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: 'IAM <no-reply@example.com>',
      to: 'root@example.com',
      subject: 'Alert: a person reached the password reveal limit',
    });

    const failingSend = vi
      .fn<MailTransport['sendMail']>()
      .mockRejectedValue(new Error('550 rejected root@example.com'));
    const failure = await new SmtpMailer(options, 'production', { sendMail: failingSend })
      .sendRevealLimitAlert(alert)
      .catch((error: unknown) => error);
    expect(String(failure)).toBe('Error: Mail delivery failed');
  });

  it('sends the pending second factor notice to the registrant and hides the provider error', async () => {
    const notice = {
      to: 'luis@example.com',
      locale: 'es-MX' as const,
      recipientDisplayName: 'Luis',
      registeredAt: new Date('2026-03-04T15:30:00Z'),
    };
    const sendMail = vi.fn<MailTransport['sendMail']>().mockResolvedValue(undefined);
    await new SmtpMailer(options, 'production', { sendMail }).sendPendingTotpNotice(notice);

    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: 'IAM <no-reply@example.com>',
      to: 'luis@example.com',
      subject: 'Tu segundo factor sigue sin confirmarse',
    });

    const failingSend = vi
      .fn<MailTransport['sendMail']>()
      .mockRejectedValue(new Error('550 rejected luis@example.com'));
    const failure = await new SmtpMailer(options, 'production', { sendMail: failingSend })
      .sendPendingTotpNotice(notice)
      .catch((error: unknown) => error);
    expect(String(failure)).toBe('Error: Mail delivery failed');
  });

  it('refuses to run without TLS in production, and allows it only for local tests', () => {
    const plain = { ...options, security: 'none' as const };
    expect(() => new SmtpMailer(plain, 'production')).toThrow(/TLS/);
    expect(() => new SmtpMailer(plain, 'test', { sendMail: vi.fn() })).not.toThrow();
  });
});
