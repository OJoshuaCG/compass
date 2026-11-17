import { describe, expect, it } from 'vitest';

import { NodemailerSmtpTestSender } from './nodemailer-smtp-test-sender.js';
import type { HostResolver } from './guarded-https-client.js';

const INPUT = {
  connection: {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls' as const,
    username: 'mailer@example.com',
    fromAddress: 'no-reply@example.com',
  },
  password: 'secret-password',
  recipient: 'no-reply@example.com',
};

describe('NodemailerSmtpTestSender', () => {
  it('reports a blocked host by code without opening any connection', async () => {
    const guard: HostResolver = {
      resolve: () => Promise.resolve({ ok: false, code: 'HOST_NOT_ALLOWED' }),
    };
    await expect(new NodemailerSmtpTestSender(guard).send(INPUT)).resolves.toEqual({
      ok: false,
      code: 'HOST_NOT_ALLOWED',
    });
  });

  it('reports an unresolved host by code', async () => {
    const guard: HostResolver = {
      resolve: () => Promise.resolve({ ok: false, code: 'HOST_UNRESOLVED' }),
    };
    await expect(new NodemailerSmtpTestSender(guard).send(INPUT)).resolves.toEqual({
      ok: false,
      code: 'HOST_UNRESOLVED',
    });
  });
});
