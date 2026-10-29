import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import type { UserRecord } from '../../directory/index.js';
import { InMemoryMailer } from '../../notification/index.js';
import {
  RevealLimitNoticeDeliveryError,
  RevealLimitNoticePayloadError,
} from '../domain/reveal-limit-notice.js';
import { NotifyRevealLimitExceeded } from './notify-reveal-limit-exceeded.js';

const EVENT_ID = '0198bbbb-0000-7000-8000-000000000001';
const ACTOR_ID = '0198aaaa-0000-7000-8000-000000000001';
const NOW = new Date('2026-03-04T16:00:00.000Z');
const RAISED_AT = '2026-03-04T15:30:00.000Z';
const PAYLOAD = {
  actorId: ACTOR_ID,
  limitPerHour: 30,
  revealedInWindow: 30,
  windowSeconds: 3600,
  raisedAt: RAISED_AT,
};
const ROOT_CONTACT = {
  id: asUserId('0198dddd-0000-7000-8000-000000000001'),
  email: 'root@x.test',
  locale: 'es-MX' as const,
};
const SECOND_ROOT_CONTACT = {
  id: asUserId('0198dddd-0000-7000-8000-000000000002'),
  email: 'root2@x.test',
  locale: 'en-US' as const,
};

const ACTOR: UserRecord = {
  id: asUserId(ACTOR_ID),
  organizationId: asOrganizationId('0198cccc-0000-7000-8000-000000000001'),
  rank: 3,
  status: 'active',
  email: 'operator@x.test',
  displayName: 'Sofía Operadora',
  managedBy: null,
  createdBy: null,
  locale: 'es-MX',
  timezone: 'UTC',
};

function buildHandler(
  options: {
    readonly roots?: readonly { id: UserId; email: string; locale: 'es-MX' | 'en-US' }[];
    readonly alreadyDelivered?: boolean;
    readonly actor?: UserRecord | null;
  } = {},
) {
  const mailer = new InMemoryMailer();
  const roots = options.roots ?? [ROOT_CONTACT];
  // Acuses por (evento, destinataria), igual que en producción.
  const deliveredKeys = new Set<string>(
    options.alreadyDelivered === true ? roots.map((root) => `${EVENT_ID}|${root.id}`) : [],
  );
  const markDelivered = vi.fn((eventId: string, recipientId: string) => {
    deliveredKeys.add(`${eventId}|${recipientId}`);
    return Promise.resolve();
  });
  const handler = new NotifyRevealLimitExceeded({
    directory: {
      findById: () => Promise.resolve(options.actor === undefined ? ACTOR : options.actor),
      listRootContacts: () => Promise.resolve(roots),
    },
    mailer,
    clock: { now: () => NOW },
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        Promise.resolve(deliveredKeys.has(`${eventId}|${recipientId}`)),
      markDelivered,
    },
  });
  return { handler, mailer, markDelivered, deliveredKeys };
}

describe('NotifyRevealLimitExceeded', () => {
  it('emails the Root in their language with the actor, the counts and the original moment', async () => {
    const { handler, mailer, markDelivered } = buildHandler({
      roots: [{ id: ROOT_CONTACT.id, email: 'root@x.test', locale: 'en-US' }],
    });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.revealLimitAlerts).toEqual([
      {
        to: 'root@x.test',
        locale: 'en-US',
        actorDisplayName: 'Sofía Operadora',
        limitPerHour: 30,
        revealedInWindow: 30,
        windowMinutes: 60,
        occurredAt: new Date(RAISED_AT),
      },
    ]);
    expect(markDelivered).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ROOT_CONTACT.id);
  });

  it('does not resend an event that was already notified (at-least-once redelivery)', async () => {
    const { handler, mailer, markDelivered } = buildHandler({ alreadyDelivered: true });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.revealLimitAlerts).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('is idempotent when the same event is handled twice in a row', async () => {
    const { handler, mailer } = buildHandler();

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.revealLimitAlerts).toHaveLength(1);
  });

  it('still notifies, without a name, when the actor can no longer be resolved', async () => {
    const { handler, mailer } = buildHandler({ actor: null });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.revealLimitAlerts[0]?.actorDisplayName).toBeNull();
  });

  it('uses the sending time for an older event that carried no moment', async () => {
    const { handler, mailer } = buildHandler();

    await handler.handle({
      eventId: EVENT_ID,
      payload: { actorId: ACTOR_ID, limitPerHour: 30 },
    });

    expect(mailer.revealLimitAlerts[0]).toMatchObject({
      occurredAt: NOW,
      revealedInWindow: null,
      windowMinutes: null,
    });
  });

  it('fails, without marking the event as delivered, when the organization has no active Root', async () => {
    const { handler, mailer, markDelivered } = buildHandler({ roots: [] });

    await expect(handler.handle({ eventId: EVENT_ID, payload: PAYLOAD })).rejects.toMatchObject({
      code: 'VAULT.REVEAL_NOTICE_NO_ROOT',
    });
    expect(mailer.revealLimitAlerts).toHaveLength(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('fails, without marking the event as delivered, when the mail provider is down', async () => {
    const { handler, mailer, markDelivered } = buildHandler();
    mailer.failNext = true;

    const failure: unknown = await handler
      .handle({ eventId: EVENT_ID, payload: PAYLOAD })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RevealLimitNoticeDeliveryError);
    expect(failure).toMatchObject({ code: 'VAULT.REVEAL_NOTICE_SEND_FAILED' });
    // El error no arrastra el mensaje del proveedor (puede citar el destinatario).
    expect((failure as Error).message).not.toContain('provider');
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload before touching the directory or the mailer', async () => {
    const { handler, mailer } = buildHandler();

    await expect(handler.handle({ eventId: EVENT_ID, payload: { nope: true } })).rejects.toThrow(
      RevealLimitNoticePayloadError,
    );
    expect(mailer.revealLimitAlerts).toHaveLength(0);
  });

  it('on retry resends only to the Root that failed and never duplicates the one already notified', async () => {
    const { handler, mailer, markDelivered, deliveredKeys } = buildHandler({
      roots: [ROOT_CONTACT, SECOND_ROOT_CONTACT],
    });
    // Falla solo el primer envío; el segundo destinatario recibe el aviso.
    mailer.failNext = true;

    await expect(handler.handle({ eventId: EVENT_ID, payload: PAYLOAD })).rejects.toMatchObject({
      code: 'VAULT.REVEAL_NOTICE_SEND_FAILED',
    });
    expect(mailer.revealLimitAlerts.map((sent) => sent.to)).toEqual([SECOND_ROOT_CONTACT.email]);
    expect(deliveredKeys).toEqual(new Set([`${EVENT_ID}|${SECOND_ROOT_CONTACT.id}`]));

    // Reintento del trabajador: solo la pendiente recibe el aviso.
    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.revealLimitAlerts.map((sent) => sent.to)).toEqual([
      SECOND_ROOT_CONTACT.email,
      ROOT_CONTACT.email,
    ]);
    expect(markDelivered).toHaveBeenCalledTimes(2);
    expect(deliveredKeys.size).toBe(2);
  });
});
