import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { UserRecord } from '../../directory/index.js';
import { InMemoryMailer } from '../../notification/index.js';
import {
  PendingTotpNoticeDeliveryError,
  PendingTotpNoticePayloadError,
} from '../domain/pending-totp-notice.js';
import { NotifyPendingTotpUnconfirmed } from './notify-pending-totp-unconfirmed.js';
import type { CredentialRecord } from './ports/credential-repository.js';
import type { TotpRecord } from './ports/totp-repository.js';

const EVENT_ID = '0198bbbb-0000-7000-8000-000000000001';
const CREDENTIAL_ID = '0198aaaa-0000-7000-8000-000000000001';
const REGISTRANT_ID = '0198cccc-0000-7000-8000-000000000001';
const REGISTERED_AT = '2026-03-04T15:30:00.000Z';
const PAYLOAD = {
  credentialId: CREDENTIAL_ID,
  registeredBy: REGISTRANT_ID,
  registeredAt: REGISTERED_AT,
};

const REGISTRANT: UserRecord = {
  id: asUserId(REGISTRANT_ID),
  organizationId: asOrganizationId('0198dddd-0000-7000-8000-000000000001'),
  rank: 3,
  status: 'active',
  email: 'registrant@x.test',
  displayName: 'Luis Operador',
  managedBy: null,
  createdBy: null,
  locale: 'es-MX',
  timezone: 'UTC',
};

const PENDING_TOTP: TotpRecord = {
  credentialId: CREDENTIAL_ID,
  secretVersion: 1,
  status: 'pending',
  algorithm: 'SHA1',
  digits: 6,
  periodSeconds: 30,
  registeredBy: REGISTRANT_ID,
  registeredAt: new Date(REGISTERED_AT),
  verifiedAt: null,
  retiredAt: null,
  exposedAt: null,
};

const ACTIVE_CREDENTIAL: CredentialRecord = {
  id: CREDENTIAL_ID,
  accountId: '0198eeee-0000-7000-8000-000000000001',
  label: 'credential',
  kind: 'password_totp',
  lastRotatedAt: null,
  createdBy: REGISTRANT_ID,
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  archivedAt: null,
};

function buildHandler(
  options: {
    readonly totp?: TotpRecord | null;
    readonly credential?: CredentialRecord | null;
    readonly registrant?: UserRecord | null;
    readonly alreadyDelivered?: boolean;
  } = {},
) {
  const mailer = new InMemoryMailer();
  const deliveredKeys = new Set<string>(
    options.alreadyDelivered === true ? [`${EVENT_ID}|${REGISTRANT_ID}`] : [],
  );
  const markDelivered = vi.fn((eventId: string, recipientId: string) => {
    deliveredKeys.add(`${eventId}|${recipientId}`);
    return Promise.resolve();
  });
  const handler = new NotifyPendingTotpUnconfirmed({
    directory: {
      findById: () =>
        Promise.resolve(options.registrant === undefined ? REGISTRANT : options.registrant),
    },
    totps: {
      find: () => Promise.resolve(options.totp === undefined ? PENDING_TOTP : options.totp),
    },
    credentials: {
      findById: () =>
        Promise.resolve(options.credential === undefined ? ACTIVE_CREDENTIAL : options.credential),
    },
    mailer,
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        Promise.resolve(deliveredKeys.has(`${eventId}|${recipientId}`)),
      markDelivered,
    },
  });
  return { handler, mailer, markDelivered };
}

describe('NotifyPendingTotpUnconfirmed', () => {
  it('emails only the person who registered the second factor, in their language', async () => {
    const { handler, mailer, markDelivered } = buildHandler();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.pendingTotpNotices).toEqual([
      {
        to: 'registrant@x.test',
        locale: 'es-MX',
        recipientDisplayName: 'Luis Operador',
        registeredAt: new Date(REGISTERED_AT),
      },
    ]);
    expect(markDelivered).toHaveBeenCalledExactlyOnceWith(EVENT_ID, REGISTRANT_ID);
  });

  it('does not resend an event that was already notified (at-least-once redelivery)', async () => {
    const { handler, mailer, markDelivered } = buildHandler({ alreadyDelivered: true });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.pendingTotpNotices).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('is idempotent when the same event is handled twice in a row', async () => {
    const { handler, mailer } = buildHandler();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.pendingTotpNotices).toHaveLength(1);
  });

  it.each([
    [
      'confirmed in the meantime',
      { ...PENDING_TOTP, status: 'verified' as const, verifiedAt: new Date() },
    ],
    [
      'retired in the meantime',
      { ...PENDING_TOTP, status: 'retired' as const, retiredAt: new Date() },
    ],
    [
      're-registered after the sweep',
      { ...PENDING_TOTP, registeredAt: new Date('2026-03-05T10:00:00.000Z') },
    ],
    ['gone', null],
  ])('sends nothing and does not fail when the second factor was %s', async (_name, totp) => {
    const { handler, mailer, markDelivered } = buildHandler({ totp });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.pendingTotpNotices).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it.each([
    ['archived after the sweep', { ...ACTIVE_CREDENTIAL, archivedAt: new Date() }],
    ['gone', null],
  ])('sends nothing and does not fail when the credential was %s', async (_name, credential) => {
    const { handler, mailer, markDelivered } = buildHandler({ credential });

    await expect(handler.handle({ eventId: EVENT_ID, payload: PAYLOAD })).resolves.toBeUndefined();

    expect(mailer.pendingTotpNotices).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it.each([
    ['suspended', { ...REGISTRANT, status: 'suspended' as const }],
    ['deactivated', { ...REGISTRANT, status: 'deactivated' as const }],
    ['missing', null],
  ])('sends nothing and does not fail when the registrant is %s', async (_name, registrant) => {
    const { handler, mailer, markDelivered } = buildHandler({ registrant });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.pendingTotpNotices).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('fails with a domain error, without marking the delivery, when the mail provider is down', async () => {
    const { handler, mailer, markDelivered } = buildHandler();
    mailer.failNext = true;

    const failure: unknown = await handler
      .handle({ eventId: EVENT_ID, payload: PAYLOAD })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PendingTotpNoticeDeliveryError);
    expect(failure).toMatchObject({ code: 'VAULT.PENDING_TOTP_NOTICE_SEND_FAILED' });
    // El error no arrastra el mensaje del proveedor (puede citar el destinatario).
    expect((failure as Error).message).not.toContain('provider');
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('sends again on the retry after a failed attempt', async () => {
    const { handler, mailer } = buildHandler();
    mailer.failNext = true;
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD }).catch(() => undefined);

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.pendingTotpNotices).toHaveLength(1);
  });

  it('rejects an invalid payload before touching the directory or the mailer', async () => {
    const { handler, mailer } = buildHandler();

    await expect(handler.handle({ eventId: EVENT_ID, payload: { nope: true } })).rejects.toThrow(
      PendingTotpNoticePayloadError,
    );
    expect(mailer.pendingTotpNotices).toHaveLength(0);
  });
});
