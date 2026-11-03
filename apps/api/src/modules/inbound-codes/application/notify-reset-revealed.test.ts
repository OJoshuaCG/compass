import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import type { UserRecord } from '../../directory/index.js';
import { InMemoryMailer } from '../../notification/index.js';
import {
  ResetRevealNoticeDeliveryError,
  ResetRevealNoticePayloadError,
  parseResetRevealNoticePayload,
  resetRevealNoticeHandlerKey,
  serializeResetRevealNotice,
} from '../domain/reset-reveal-notice.js';
import { NotifyResetRevealed } from './notify-reset-revealed.js';

const EVENT_ID = '0198bbbb-0000-7000-8000-000000000001';
const ACTOR_ID = '0198aaaa-0000-7000-8000-000000000001';
const VIEW_ID = '0198bbbb-0000-7000-8000-000000000009';
const REVEALED_AT = new Date('2026-11-03T15:30:00.000Z');
const PAYLOAD = serializeResetRevealNotice({
  actorId: ACTOR_ID,
  viewId: VIEW_ID,
  revealedCount: 2,
  revealedAt: REVEALED_AT,
});
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
  rank: 1,
  status: 'active',
  email: 'admin@x.test',
  displayName: 'Sofía Administradora',
  managedBy: null,
  createdBy: null,
  locale: 'es-MX',
  timezone: 'UTC',
};

function buildHandler(
  options: {
    readonly roots?: readonly { id: UserId; email: string; locale: 'es-MX' | 'en-US' }[];
    readonly alreadyDelivered?: readonly UserId[];
    readonly actor?: UserRecord | null;
  } = {},
) {
  const mailer = new InMemoryMailer();
  const roots = options.roots ?? [ROOT_CONTACT];
  const deliveredKeys = new Set<string>(
    (options.alreadyDelivered ?? []).map((id) => `${EVENT_ID}|${id}`),
  );
  const markDelivered = vi.fn((eventId: string, recipientId: string) => {
    deliveredKeys.add(`${eventId}|${recipientId}`);
    return Promise.resolve();
  });
  const handler = new NotifyResetRevealed({
    directory: {
      findById: () => Promise.resolve(options.actor === undefined ? ACTOR : options.actor),
      listRootContacts: () => Promise.resolve(roots),
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

describe('NotifyResetRevealed', () => {
  it('avisa a cada Raíz con su idioma, el nombre, el conteo y la hora; y anota el acuse', async () => {
    const { handler, mailer, markDelivered } = buildHandler({
      roots: [ROOT_CONTACT, SECOND_ROOT_CONTACT],
    });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.resetRevealAlerts).toEqual([
      {
        to: 'root@x.test',
        locale: 'es-MX',
        actorDisplayName: 'Sofía Administradora',
        revealedCount: 2,
        occurredAt: REVEALED_AT,
      },
      {
        to: 'root2@x.test',
        locale: 'en-US',
        actorDisplayName: 'Sofía Administradora',
        revealedCount: 2,
        occurredAt: REVEALED_AT,
      },
    ]);
    expect(markDelivered).toHaveBeenCalledTimes(2);
  });

  it('no reenvía a quien ya tiene acuse', async () => {
    const { handler, mailer } = buildHandler({
      roots: [ROOT_CONTACT, SECOND_ROOT_CONTACT],
      alreadyDelivered: [ROOT_CONTACT.id],
    });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.resetRevealAlerts.map((alert) => alert.to)).toEqual(['root2@x.test']);
  });

  it('sin Raíz activa lanza para reintentar', async () => {
    const { handler } = buildHandler({ roots: [] });

    await expect(handler.handle({ eventId: EVENT_ID, payload: PAYLOAD })).rejects.toMatchObject({
      code: 'INBOUND.RESET_NOTICE_NO_ROOT',
    });
  });

  it('si un envío falla lanza al final sin anotar ese acuse', async () => {
    const { handler, mailer, markDelivered } = buildHandler();
    mailer.failNext = true;

    await expect(handler.handle({ eventId: EVENT_ID, payload: PAYLOAD })).rejects.toBeInstanceOf(
      ResetRevealNoticeDeliveryError,
    );
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('sin persona resoluble el aviso sale igual, sin nombre', async () => {
    const { handler, mailer } = buildHandler({ actor: null });

    await handler.handle({ eventId: EVENT_ID, payload: PAYLOAD });

    expect(mailer.resetRevealAlerts[0]?.actorDisplayName).toBeNull();
  });

  it('un contenido mal formado va a cuarentena sin reintentos', async () => {
    const { handler, mailer } = buildHandler();

    await expect(
      handler.handle({ eventId: EVENT_ID, payload: { ...PAYLOAD, revealedCount: 0 } }),
    ).rejects.toBeInstanceOf(ResetRevealNoticePayloadError);
    expect(mailer.resetRevealAlerts).toHaveLength(0);
  });
});

describe('reset-reveal-notice', () => {
  it('el contenido serializado solo lleva ids, conteo y hora, y se lee de vuelta', () => {
    expect(Object.keys(PAYLOAD).sort()).toEqual([
      'actorId',
      'revealedAt',
      'revealedCount',
      'viewId',
    ]);
    expect(parseResetRevealNoticePayload(PAYLOAD)).toEqual({
      actorId: ACTOR_ID,
      viewId: VIEW_ID,
      revealedCount: 2,
      revealedAt: REVEALED_AT,
    });
  });

  it.each([null, [], { ...PAYLOAD, actorId: '' }, { ...PAYLOAD, revealedAt: 'ayer' }])(
    'rechaza un contenido inválido: %o',
    (payload) => {
      expect(() => parseResetRevealNoticePayload(payload)).toThrow(ResetRevealNoticePayloadError);
    },
  );

  it('la clave del acuse cabe en handler_key (100)', () => {
    expect(resetRevealNoticeHandlerKey(ROOT_CONTACT.id).length).toBeLessThanOrEqual(100);
  });
});
