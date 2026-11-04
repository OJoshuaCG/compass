import { describe, expect, it } from 'vitest';

import type { RootTransferNoticeMessage } from './ports/mailer.js';
import { renderRootTransferEmail } from './render-root-transfer-email.js';

const BASE: RootTransferNoticeMessage = {
  to: 'a@x.test',
  locale: 'es-MX',
  kind: 'completed',
  recipientRole: 'new_root',
  fromDisplayName: 'Ada',
  toDisplayName: 'Grace',
  automatic: false,
  occurredAt: new Date('2026-11-04T15:30:00.000Z'),
  executesAt: null,
};

describe('renderRootTransferEmail', () => {
  it.each(['es-MX', 'en-US'] as const)(
    'warns in %s that emergency recovery is unavailable once the transfer completes',
    (locale) => {
      for (const recipientRole of ['previous_root', 'new_root', 'administrator'] as const) {
        const email = renderRootTransferEmail({ ...BASE, locale, recipientRole });
        expect(email.text).toMatch(
          locale === 'es-MX' ? /recuperación de emergencia/ : /emergency recovery/,
        );
      }
    },
  );

  it('states the execution date in UTC when the proposal is accepted', () => {
    const email = renderRootTransferEmail({
      ...BASE,
      kind: 'accepted',
      recipientRole: 'administrator',
      executesAt: new Date('2026-11-07T15:30:00.000Z'),
    });
    expect(email.text).toContain('UTC');
    expect(email.text).toContain('2026');
  });

  it('escapes and sanitizes the names and never includes a link', () => {
    const email = renderRootTransferEmail({
      ...BASE,
      kind: 'requested',
      fromDisplayName: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toMatch(/https?:|href/);
    expect(email.text).not.toMatch(/https?:/);
  });

  it('says so when the cancellation was automatic', () => {
    const automatic = renderRootTransferEmail({ ...BASE, kind: 'cancelled', automatic: true });
    const manual = renderRootTransferEmail({ ...BASE, kind: 'cancelled', automatic: false });
    expect(automatic.text).toContain('sola');
    expect(manual.text).not.toContain('sola');
  });

  it('falls back to a neutral phrase when a person cannot be resolved', () => {
    const email = renderRootTransferEmail({
      ...BASE,
      kind: 'requested',
      recipientRole: 'administrator',
      fromDisplayName: null,
    });
    expect(email.text).toContain('una persona de la organización');
  });
});
