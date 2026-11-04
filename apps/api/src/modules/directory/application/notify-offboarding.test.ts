import { describe, expect, it } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import { InMemoryMailer } from '../../notification/index.js';
import {
  OffboardingNoticeDeliveryError,
  OffboardingNoticePayloadError,
} from '../domain/offboarding-notice.js';
import type { OffboardingNoticeRole } from '../domain/offboarding-notice.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { NotifyOffboarding } from './notify-offboarding.js';

const EVENT_ID = 'event-1';
const ROOT_ID = 'root';
const ADMIN_ID = 'admin';
const ACTOR_ID = 'actor';
const RECEIVER_ID = 'receiver';
const LEAVER_ID = 'leaver';
const OFFBOARDED_AT = '2026-11-04T15:30:00.000Z';

const PAYLOAD = {
  leaverId: LEAVER_ID,
  actorId: ACTOR_ID,
  receiverId: RECEIVER_ID,
  notifyReceiver: true,
  assignedAccountCount: 2,
  unassignedAccountCount: 0,
  rotationTaskCount: 5,
  offboardedAt: OFFBOARDED_AT,
};

function user(id: string, rank: 0 | 1 | 2 | 3, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: asUserId(id),
    organizationId: asOrganizationId('org-1'),
    rank,
    status: 'active',
    email: `${id}@x.test`,
    displayName: `Nombre ${id}`,
    managedBy: rank === 0 ? null : asUserId(ROOT_ID),
    createdBy: null,
    locale: 'es-MX',
    timezone: 'UTC',
    ...overrides,
  };
}

function setup(overrides: Record<string, UserRecord> = {}) {
  const directory = new InMemoryUserDirectory();
  const people = {
    [ROOT_ID]: user(ROOT_ID, 0),
    [ADMIN_ID]: user(ADMIN_ID, 1),
    [ACTOR_ID]: user(ACTOR_ID, 2),
    [RECEIVER_ID]: user(RECEIVER_ID, 1, { locale: 'en-US' }),
    [LEAVER_ID]: user(LEAVER_ID, 3, { status: 'deactivated' }),
    ...overrides,
  };
  for (const person of Object.values(people)) directory.add(person);

  const mailer = new InMemoryMailer();
  const delivered = new Set<string>();
  const handler = new NotifyOffboarding({
    directory,
    mailer,
    deliveries: {
      wasDelivered: (eventId: string, role: OffboardingNoticeRole, recipientId: string) =>
        Promise.resolve(delivered.has(`${eventId}|${role}|${recipientId}`)),
      markDelivered: (eventId: string, role: OffboardingNoticeRole, recipientId: string) => {
        delivered.add(`${eventId}|${role}|${recipientId}`);
        return Promise.resolve();
      },
    },
  });
  return { handler, mailer, delivered };
}

const recipients = (mailer: InMemoryMailer, kind: string) =>
  mailer.offboardingNotices.filter((notice) => notice.kind === kind).map((notice) => notice.to);

describe('NotifyOffboarding', () => {
  it('tells a receiver outside the branch how many accounts came to them, in their language', async () => {
    const { handler, mailer } = setup();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    const notice = mailer.offboardingNotices.find((n) => n.kind === 'accounts_assigned');
    expect(notice).toMatchObject({
      to: 'receiver@x.test',
      locale: 'en-US',
      accountCount: 2,
      leaverDisplayName: 'Nombre leaver',
    });
  });

  it('does not tell a receiver inside the branch', async () => {
    const { handler, mailer } = setup();

    await handler.handle({ eventId: EVENT_ID, payload: { ...PAYLOAD, notifyReceiver: false } });

    expect(recipients(mailer, 'accounts_assigned')).toEqual([]);
  });

  it('alerts Administrators and Root, once each, when an account is left without an owner', async () => {
    const { handler, mailer } = setup();

    await handler.handle({
      eventId: EVENT_ID,
      payload: { ...PAYLOAD, receiverId: null, notifyReceiver: false, unassignedAccountCount: 3 },
    });

    expect(recipients(mailer, 'accounts_unassigned').sort()).toEqual([
      'admin@x.test',
      'receiver@x.test',
      'root@x.test',
    ]);
    expect(mailer.offboardingNotices.find((n) => n.kind === 'accounts_unassigned')).toMatchObject({
      accountCount: 3,
    });
  });

  it('sends no alert when every account found an owner', async () => {
    const { handler, mailer } = setup();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(recipients(mailer, 'accounts_unassigned')).toEqual([]);
  });

  it('sends the actor a report with only counts', async () => {
    const { handler, mailer } = setup();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    const report = mailer.offboardingNotices.find((n) => n.kind === 'report');
    expect(report?.to).toBe('actor@x.test');
    expect(report?.report).toEqual({
      assignedAccountCount: 2,
      unassignedAccountCount: 0,
      rotationTaskCount: 5,
    });
  });

  it('skips a recipient who is no longer active', async () => {
    const { handler, mailer } = setup({
      [RECEIVER_ID]: user(RECEIVER_ID, 1, { status: 'suspended' }),
      [ACTOR_ID]: user(ACTOR_ID, 2, { status: 'deactivated' }),
    });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.offboardingNotices).toEqual([]);
  });

  it('is idempotent: a redelivered event sends nothing twice', async () => {
    const { handler, mailer } = setup();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    const firstRound = mailer.offboardingNotices.length;
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(firstRound).toBeGreaterThan(0);
    expect(mailer.offboardingNotices).toHaveLength(firstRound);
  });

  it('throws a generic delivery error without the provider message and records no receipt', async () => {
    const { handler, mailer, delivered } = setup();
    mailer.failNext = true;

    const attempt = handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    await expect(attempt).rejects.toBeInstanceOf(OffboardingNoticeDeliveryError);
    await expect(attempt).rejects.not.toThrow(/provider/);
    expect(delivered.size).toBe(0);
  });

  it('sends a delivered notice and keeps the pending ones after a failure in a later one', async () => {
    const { handler, mailer, delivered } = setup();
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    delivered.delete(`${EVENT_ID}|report|${ACTOR_ID}`);
    const before = mailer.offboardingNotices.length;

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.offboardingNotices).toHaveLength(before + 1);
    expect(mailer.offboardingNotices.at(-1)?.kind).toBe('report');
  });

  it.each([
    ['not an object', 'text'],
    ['a count that is negative', { ...PAYLOAD, assignedAccountCount: -1 }],
    ['a missing actor', { ...PAYLOAD, actorId: '' }],
    ['a date that is not valid', { ...PAYLOAD, offboardedAt: 'ayer' }],
    ['a receiver of the wrong type', { ...PAYLOAD, receiverId: 5 }],
  ])('rejects a payload with %s and marks it as not retryable', async (_label, payload) => {
    const { handler } = setup();

    const attempt = handler.handle({ eventId: EVENT_ID, payload });

    await expect(attempt).rejects.toBeInstanceOf(OffboardingNoticePayloadError);
    await expect(attempt).rejects.toMatchObject({ retryable: false });
  });
});
