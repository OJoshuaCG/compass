import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SmtpMailer } from '../src/modules/notification/index.js';

/** Servidor SMTP real de pruebas (Mailpit): comprueba el envío de punta a punta, sin proveedor externo. */
let container: StartedTestContainer;
let apiBase: string;
let smtpPort: number;
let smtpHost: string;

beforeAll(async () => {
  container = await new GenericContainer('axllent/mailpit:v1.21.8')
    .withExposedPorts(1025, 8025)
    .withEnvironment({ MP_SMTP_AUTH_ACCEPT_ANY: '1', MP_SMTP_AUTH_ALLOW_INSECURE: '1' })
    .withWaitStrategy(Wait.forHttp('/livez', 8025))
    .start();
  smtpHost = container.getHost();
  smtpPort = container.getMappedPort(1025);
  apiBase = `http://${smtpHost}:${String(container.getMappedPort(8025))}`;
}, 120_000);

afterAll(async () => {
  await container.stop();
});

describe('SmtpMailer against a real SMTP server', () => {
  it('delivers the invitation with its link, for a guest at another domain', async () => {
    const mailer = new SmtpMailer(
      {
        host: smtpHost,
        port: smtpPort,
        security: 'none',
        user: 'no-reply@example.com',
        password: 'whatever',
        from: 'IAM <no-reply@example.com>',
        baseUrl: 'https://iam.example.com',
      },
      'test',
    );

    await mailer.sendInvitation({
      to: 'guest@other-domain.test',
      token: 'abc123tokenvalue',
      expiresAt: new Date('2026-11-01T15:30:00Z'),
      locale: 'en-US',
    });

    const list = (await (await fetch(`${apiBase}/api/v1/messages`)).json()) as {
      messages: {
        ID: string;
        Subject: string;
        To: { Address: string }[];
        From: { Address: string };
      }[];
    };
    const sent = list.messages[0];
    expect(sent?.Subject).toBe('You have been invited to the platform');
    expect(sent?.To[0]?.Address).toBe('guest@other-domain.test');
    expect(sent?.From.Address).toBe('no-reply@example.com');
    const detail = (await (await fetch(`${apiBase}/api/v1/message/${sent?.ID ?? ''}`)).json()) as {
      Text: string;
    };
    expect(detail.Text).toContain('https://iam.example.com/invitation#token=abc123tokenvalue');
  });

  it('fails with the generic error when the server is unreachable', async () => {
    const mailer = new SmtpMailer(
      {
        host: '127.0.0.1',
        port: 1,
        security: 'none',
        user: undefined,
        password: undefined,
        from: 'IAM <no-reply@example.com>',
        baseUrl: 'https://iam.example.com',
      },
      'test',
    );
    await expect(
      mailer.sendInvitation({
        to: 'guest@example.com',
        token: 'abc',
        expiresAt: new Date(),
        locale: 'es-MX',
      }),
    ).rejects.toThrow('Mail delivery failed');
  });
});
