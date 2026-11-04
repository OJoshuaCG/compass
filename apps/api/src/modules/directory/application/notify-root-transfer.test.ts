import { describe, expect, it } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import { InMemoryMailer } from '../../notification/index.js';
import {
  RootTransferNoticeDeliveryError,
  RootTransferNoticePayloadError,
} from '../domain/root-transfer-notice.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { NotifyRootTransfer } from './notify-root-transfer.js';

const EVENT_ID = 'event-1';
const FROM_ID = 'root';
const TO_ID = 'admin';
const OTHER_ADMIN_ID = 'other-admin';
const OCCURRED_AT = '2026-11-04T15:30:00.000Z';
const EXECUTES_AT = '2026-11-07T15:30:00.000Z';

const payload = (kind: string, overrides: Record<string, unknown> = {}) => ({
  kind,
  transferId: 'transfer-1',
  fromUserId: FROM_ID,
  toUserId: TO_ID,
  actorId: FROM_ID,
  occurredAt: OCCURRED_AT,
  executesAt: kind === 'accepted' ? EXECUTES_AT : null,
  ...overrides,
});

function user(id: string, rank: 0 | 1, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: asUserId(id),
    organizationId: asOrganizationId('org-1'),
    rank,
    status: 'active',
    email: `${id}@x.test`,
    displayName: `Nombre ${id}`,
    managedBy: rank === 0 ? null : asUserId(FROM_ID),
    createdBy: null,
    locale: 'es-MX',
    timezone: 'UTC',
    ...overrides,
  };
}

function setup(overrides: Record<string, UserRecord> = {}) {
  const directory = new InMemoryUserDirectory();
  const people = {
    [FROM_ID]: user(FROM_ID, 0),
    [TO_ID]: user(TO_ID, 1, { locale: 'en-US' }),
    [OTHER_ADMIN_ID]: user(OTHER_ADMIN_ID, 1),
    ...overrides,
  };
  for (const person of Object.values(people)) directory.add(person);
  const mailer = new InMemoryMailer();
  const delivered = new Set<string>();
  const handler = new NotifyRootTransfer({
    directory,
    mailer,
    receipts: {
      wasDelivered: (eventId, key) => Promise.resolve(delivered.has(`${eventId}|${key}`)),
      markDelivered: (eventId, key) => {
        delivered.add(`${eventId}|${key}`);
        return Promise.resolve();
      },
    },
  });
  return { handler, mailer };
}

describe('NotifyRootTransfer', () => {
  it('notifies the root, the target and the administrators once each, with their role and language', async () => {
    const { handler, mailer } = setup();
    await handler.handle({ eventId: EVENT_ID, payload: payload('requested') });
    const byRecipient = Object.fromEntries(
      mailer.rootTransferNotices.map((notice) => [notice.to, notice]),
    );
    expect(Object.keys(byRecipient).sort()).toEqual([
      'admin@x.test',
      'other-admin@x.test',
      'root@x.test',
    ]);
    expect(byRecipient['root@x.test']).toMatchObject({
      recipientRole: 'previous_root',
      locale: 'es-MX',
    });
    expect(byRecipient['admin@x.test']).toMatchObject({
      recipientRole: 'new_root',
      locale: 'en-US',
    });
    expect(byRecipient['other-admin@x.test']).toMatchObject({ recipientRole: 'administrator' });
  });

  it('is idempotent: delivering the same event again sends nothing', async () => {
    const { handler, mailer } = setup();
    await handler.handle({ eventId: EVENT_ID, payload: payload('requested') });
    await handler.handle({ eventId: EVENT_ID, payload: payload('requested') });
    expect(mailer.rootTransferNotices).toHaveLength(3);
  });

  it('marks an automatic cancellation and carries the execution date on acceptance', async () => {
    const { handler, mailer } = setup();
    await handler.handle({ eventId: 'e-1', payload: payload('cancelled', { actorId: null }) });
    expect(mailer.rootTransferNotices.every((notice) => notice.automatic)).toBe(true);
    await handler.handle({ eventId: 'e-2', payload: payload('accepted') });
    const accepted = mailer.rootTransferNotices.filter((notice) => notice.kind === 'accepted');
    expect(accepted.every((notice) => notice.executesAt?.toISOString() === EXECUTES_AT)).toBe(true);
    expect(accepted.every((notice) => !notice.automatic)).toBe(true);
  });

  it('still tells the previous root (now invited) that the transfer completed, but not a suspended administrator', async () => {
    const { handler, mailer } = setup({
      [FROM_ID]: user(FROM_ID, 1, { status: 'invited' }),
      [OTHER_ADMIN_ID]: user(OTHER_ADMIN_ID, 1, { status: 'suspended' }),
    });
    await handler.handle({ eventId: EVENT_ID, payload: payload('completed') });
    const recipients = mailer.rootTransferNotices.map((notice) => notice.to).sort();
    expect(recipients).toEqual(['admin@x.test', 'root@x.test']);
  });

  it('replaces a provider failure with a generic error that carries no data', async () => {
    const { handler, mailer } = setup();
    mailer.failNext = true;
    const failure = await handler
      .handle({ eventId: EVENT_ID, payload: payload('requested') })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RootTransferNoticeDeliveryError);
    expect(String(failure)).not.toContain('@');
  });

  it.each([
    null,
    'text',
    { ...payload('requested'), kind: 'other' },
    { ...payload('requested'), occurredAt: 'x' },
  ])('rejects an invalid payload without retrying', async (bad) => {
    const { handler } = setup();
    await expect(handler.handle({ eventId: EVENT_ID, payload: bad })).rejects.toBeInstanceOf(
      RootTransferNoticePayloadError,
    );
  });
});
