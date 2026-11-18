import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { InfrastructureAlertMessage, Mailer } from '../application/ports/mailer.js';
import { OrganizationMailer } from './organization-mailer.js';

const MESSAGE: InfrastructureAlertMessage = {
  to: 'root@example.com',
  locale: 'es-MX',
  code: 'job_failed',
  occurredAt: new Date('2026-11-17T10:00:00.000Z'),
};

function fakeMailer(): { mailer: Mailer; sendInfrastructureAlert: Mock } {
  const sendInfrastructureAlert = vi.fn(() => Promise.resolve());
  const mailer = { sendInfrastructureAlert } as unknown as Mailer;
  return { mailer, sendInfrastructureAlert };
}

describe('OrganizationMailer', () => {
  it('uses the organization mailer when the selector returns one', async () => {
    const fallback = fakeMailer();
    const organizational = fakeMailer();
    const mailer = new OrganizationMailer(fallback.mailer, {
      select: () => Promise.resolve(organizational.mailer),
    });

    await mailer.sendInfrastructureAlert(MESSAGE);

    expect(organizational.sendInfrastructureAlert).toHaveBeenCalledWith(MESSAGE);
    expect(fallback.sendInfrastructureAlert).not.toHaveBeenCalled();
  });

  it('falls back to the environment mailer when the organization has no server', async () => {
    const fallback = fakeMailer();
    const mailer = new OrganizationMailer(fallback.mailer, { select: () => Promise.resolve(null) });

    await mailer.sendInfrastructureAlert(MESSAGE);

    expect(fallback.sendInfrastructureAlert).toHaveBeenCalledWith(MESSAGE);
  });

  it('does not fall back when the configured server cannot be used', async () => {
    const fallback = fakeMailer();
    const mailer = new OrganizationMailer(fallback.mailer, {
      select: () => Promise.reject(new Error('host not allowed')),
    });

    await expect(mailer.sendInfrastructureAlert(MESSAGE)).rejects.toThrow('host not allowed');
    expect(fallback.sendInfrastructureAlert).not.toHaveBeenCalled();
  });
});
