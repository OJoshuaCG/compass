import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryMailer } from '../../notification/index.js';
import {
  RankChangeNoticeDeliveryError,
  RankChangeNoticePayloadError,
} from '../domain/rank-change-notice.js';
import { NotifyRankChanged } from './notify-rank-changed.js';

const EVENT_ID = '0198bbbb-0000-7000-8000-000000000001';
const TARGET_ID = '0198aaaa-0000-7000-8000-000000000001';
const CHANGED_BY_ID = '0198aaaa-0000-7000-8000-000000000002';
const CHANGED_AT = '2026-03-04T15:30:00.000Z';
const PAYLOAD = {
  targetId: TARGET_ID,
  changedBy: CHANGED_BY_ID,
  fromRank: 3,
  toRank: 2,
  changedAt: CHANGED_AT,
};

const buildUser = (id: string, overrides: Partial<UserRecord>): UserRecord => ({
  id: asUserId(id),
  organizationId: asOrganizationId('0198cccc-0000-7000-8000-000000000001'),
  rank: 3,
  status: 'active',
  email: 'persona@x.test',
  displayName: 'Persona',
  managedBy: null,
  createdBy: null,
  locale: 'en-US',
  timezone: 'UTC',
  ...overrides,
});

function buildHandler(
  options: {
    readonly target?: UserRecord | null;
    readonly changedBy?: UserRecord | null;
    readonly alreadyDelivered?: boolean;
  } = {},
) {
  const mailer = new InMemoryMailer();
  const target = options.target === undefined ? buildUser(TARGET_ID, {}) : options.target;
  const changedBy =
    options.changedBy === undefined
      ? buildUser(CHANGED_BY_ID, { displayName: 'Ana Administradora', locale: 'es-MX' })
      : options.changedBy;
  const deliveredKeys = new Set<string>(
    options.alreadyDelivered === true ? [`${EVENT_ID}|${TARGET_ID}`] : [],
  );
  const markDelivered = vi.fn((eventId: string, recipientId: string) => {
    deliveredKeys.add(`${eventId}|${recipientId}`);
    return Promise.resolve();
  });
  const handler = new NotifyRankChanged({
    directory: {
      findById: (id) => Promise.resolve(id === asUserId(TARGET_ID) ? target : changedBy),
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

describe('NotifyRankChanged', () => {
  it('emails the affected person in their language with who made the change, and records the receipt', async () => {
    const { handler, mailer, markDelivered } = buildHandler();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.rankChangeNotices).toEqual([
      {
        to: 'persona@x.test',
        // Idioma de la persona afectada, no el de quien hizo el cambio (es-MX).
        locale: 'en-US',
        changedByDisplayName: 'Ana Administradora',
        fromRank: 3,
        toRank: 2,
        changedAt: new Date(CHANGED_AT),
      },
    ]);
    expect(markDelivered).toHaveBeenCalledWith(EVENT_ID, TARGET_ID);
  });

  it('is idempotent: does not resend when the receipt already exists', async () => {
    const { handler, mailer, markDelivered } = buildHandler({ alreadyDelivered: true });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.rankChangeNotices).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('does not resend on a second delivery of the same event', async () => {
    const { handler, mailer } = buildHandler();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.rankChangeNotices).toHaveLength(1);
  });

  it('throws without a receipt when the mail provider fails, and sends on the retry', async () => {
    const { handler, mailer, markDelivered } = buildHandler();
    mailer.failNext = true;

    const failure = await handler
      .handle({ eventId: EVENT_ID, payload: PAYLOAD })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RankChangeNoticeDeliveryError);
    // El error no cita al destinatario ni al proveedor.
    expect(String(failure)).not.toContain('persona@x.test');
    expect(markDelivered).not.toHaveBeenCalled();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.rankChangeNotices).toHaveLength(1);
    expect(markDelivered).toHaveBeenCalledTimes(1);
  });

  it('still sends, without a name, when the person who made the change no longer resolves', async () => {
    const { handler, mailer } = buildHandler({ changedBy: null });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.rankChangeNotices[0]?.changedByDisplayName).toBeNull();
  });

  it('skips without failing when the person no longer exists or was deactivated', async () => {
    const missing = buildHandler({ target: null });
    const deactivated = buildHandler({ target: buildUser(TARGET_ID, { status: 'deactivated' }) });

    await missing.handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    await deactivated.handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(missing.mailer.rankChangeNotices).toHaveLength(0);
    expect(deactivated.mailer.rankChangeNotices).toHaveLength(0);
  });

  it.each([
    ['not an object', 'text'],
    ['missing target', { ...PAYLOAD, targetId: undefined }],
    ['rank out of range', { ...PAYLOAD, toRank: 7 }],
    ['rank not an integer', { ...PAYLOAD, fromRank: 1.5 }],
    ['invalid date', { ...PAYLOAD, changedAt: 'not-a-date' }],
  ])('rejects a payload that is %s', async (_label, payload) => {
    const { handler, mailer } = buildHandler();

    await expect(handler.handle({ eventId: EVENT_ID, payload })).rejects.toBeInstanceOf(
      RankChangeNoticePayloadError,
    );
    expect(mailer.rankChangeNotices).toHaveLength(0);
  });
});
