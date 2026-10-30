import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { UserRecord } from '../../directory/index.js';
import { InMemoryMailer } from '../../notification/index.js';
import {
  SecurityNoticeDeliveryError,
  SecurityNoticePayloadError,
} from '../domain/security-notice-event.js';
import { NotifySecurityNotice } from './notify-security-notice.js';

const EVENT_ID = '0198bbbb-0000-7000-8000-000000000001';
const USER_ID = '0198aaaa-0000-7000-8000-000000000001';
const OCCURRED_AT = '2026-03-04T15:30:00.000Z';
const PAYLOAD = { userId: USER_ID, kind: 'totp_removed', occurredAt: OCCURRED_AT };

const buildUser = (overrides: Partial<UserRecord>): UserRecord => ({
  id: asUserId(USER_ID),
  organizationId: asOrganizationId('0198cccc-0000-7000-8000-000000000001'),
  rank: 3,
  status: 'active',
  email: 'persona@x.test',
  displayName: 'Persona',
  managedBy: null,
  createdBy: null,
  locale: 'es-MX',
  timezone: 'UTC',
  ...overrides,
});

function buildHandler(
  options: { readonly user?: UserRecord | null; readonly alreadyDelivered?: boolean } = {},
) {
  const mailer = new InMemoryMailer();
  const user = options.user === undefined ? buildUser({}) : options.user;
  const deliveredKeys = new Set<string>(
    options.alreadyDelivered === true ? [`${EVENT_ID}|${USER_ID}`] : [],
  );
  const markDelivered = vi.fn((eventId: string, recipientId: string) => {
    deliveredKeys.add(`${eventId}|${recipientId}`);
    return Promise.resolve();
  });
  const handler = new NotifySecurityNotice({
    directory: { findById: () => Promise.resolve(user) },
    mailer,
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        Promise.resolve(deliveredKeys.has(`${eventId}|${recipientId}`)),
      markDelivered,
    },
  });
  return { handler, mailer, markDelivered };
}

describe('NotifySecurityNotice', () => {
  it('emails only the account owner in their language and records the receipt', async () => {
    const { handler, mailer, markDelivered } = buildHandler();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.notices).toEqual([
      {
        to: 'persona@x.test',
        locale: 'es-MX',
        kind: 'totp_removed',
        occurredAt: new Date(OCCURRED_AT),
      },
    ]);
    expect(markDelivered).toHaveBeenCalledWith(EVENT_ID, USER_ID);
  });

  it('is idempotent: does not resend when the receipt already exists', async () => {
    const { handler, mailer, markDelivered } = buildHandler({ alreadyDelivered: true });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.notices).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('does not resend on a second delivery of the same event', async () => {
    const { handler, mailer } = buildHandler();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.notices).toHaveLength(1);
  });

  it('throws without a receipt when the mail provider fails, and sends on the retry', async () => {
    const { handler, mailer, markDelivered } = buildHandler();
    mailer.failNext = true;

    const failure = await handler
      .handle({ eventId: EVENT_ID, payload: PAYLOAD })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SecurityNoticeDeliveryError);
    expect(String(failure)).not.toContain('persona@x.test');
    expect(markDelivered).not.toHaveBeenCalled();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.notices).toHaveLength(1);
    expect(markDelivered).toHaveBeenCalledTimes(1);
  });

  it('skips without failing when the person no longer exists or was deactivated', async () => {
    const missing = buildHandler({ user: null });
    const deactivated = buildHandler({ user: buildUser({ status: 'deactivated' }) });

    await missing.handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    await deactivated.handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(missing.mailer.notices).toHaveLength(0);
    expect(deactivated.mailer.notices).toHaveLength(0);
  });

  it('still notifies a person who is invited (the emergency reset leaves them in that state)', async () => {
    const { handler, mailer } = buildHandler({ user: buildUser({ status: 'invited' }) });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.notices).toHaveLength(1);
  });

  it.each([
    ['not an object', 'text'],
    ['missing user', { ...PAYLOAD, userId: undefined }],
    ['unknown kind', { ...PAYLOAD, kind: 'passkey_added' }],
    ['invalid date', { ...PAYLOAD, occurredAt: 'not-a-date' }],
  ])('rejects a payload that is %s, without retrying', async (_label, payload) => {
    const { handler, mailer } = buildHandler();

    const failure = await handler.handle({ eventId: EVENT_ID, payload }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(SecurityNoticePayloadError);
    expect((failure as SecurityNoticePayloadError).retryable).toBe(false);
    expect(mailer.notices).toHaveLength(0);
  });
});
