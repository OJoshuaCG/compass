import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../shared/kernel/index.js';
import type { InfrastructureAlertMessage } from '../../notification/index.js';
import type { InfrastructureAlertChannels } from '../domain/alert-settings.js';
import { InfrastructureAlertDeliveryError } from '../domain/infrastructure-alert.js';
import { NotifyInfrastructureAlert } from './notify-infrastructure-alert.js';
import type { ActiveTelegramChannel } from './ports/telegram-channel-store.js';
import type { TelegramMessage, TelegramSendResult } from './ports/telegram-sender.js';

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const INTEGRATION_ID = '0190aaaa-0000-7000-8000-000000000001';
const BOT_TOKEN = '123456789:AAFakeTokenForTestsOnly_0123456789abcd';
const CHAT_ID = '-100200300';
const OCCURRED_AT = '2026-11-03T10:00:00.000Z';

const CHANNEL: ActiveTelegramChannel = {
  integrationId: INTEGRATION_ID,
  chatId: CHAT_ID,
  botTokenVersion: 3,
  botToken: { ciphertext: new Uint8Array([1, 2, 3]), nonce: new Uint8Array(12), dekVersion: 2 },
};

interface RootContactFixture {
  readonly id: UserId;
  readonly email: string;
  readonly locale: 'es-MX' | 'en-US';
}
const ROOT_A: RootContactFixture = {
  id: 'root-a' as UserId,
  email: 'root-a@x.test',
  locale: 'es-MX',
};
const ROOT_B: RootContactFixture = {
  id: 'root-b' as UserId,
  email: 'root-b@x.test',
  locale: 'en-US',
};
const EVENT_ID = '0190bbbb-0000-7000-8000-000000000009';

function buildHandler(options: {
  channel?: ActiveTelegramChannel | null;
  decryptOk?: boolean;
  sendResult?: TelegramSendResult;
  channels?: InfrastructureAlertChannels;
  roots?: readonly RootContactFixture[];
  failingRecipients?: readonly string[];
  alreadyDelivered?: readonly string[];
}) {
  const find = vi.fn(() =>
    Promise.resolve({
      infrastructure: options.channels ?? { email: false, telegram: true },
      updatedBy: null,
      updatedAt: null,
      version: 0,
    }),
  );
  const findActiveChannel = vi.fn(() => Promise.resolve(options.channel ?? null));
  const decrypt = vi.fn(() =>
    Promise.resolve(
      options.decryptOk === false
        ? { ok: false as const, error: new Error('cannot open') }
        : { ok: true as const, value: new TextEncoder().encode(BOT_TOKEN) },
    ),
  );
  const send = vi.fn<(message: TelegramMessage) => Promise<TelegramSendResult>>(() =>
    Promise.resolve(options.sendResult ?? { ok: true }),
  );
  const listRootContacts = vi.fn(() => Promise.resolve(options.roots ?? [ROOT_A]));
  const sendInfrastructureAlert = vi.fn((message: InfrastructureAlertMessage) =>
    options.failingRecipients?.includes(message.to) === true
      ? Promise.reject(new Error('mail provider unavailable'))
      : Promise.resolve(),
  );
  const delivered = new Set<string>(options.alreadyDelivered ?? []);
  const markDelivered = vi.fn((eventId: string, key: string) => {
    delivered.add(`${eventId}|${key}`);
    return Promise.resolve();
  });
  const handler = new NotifyInfrastructureAlert({
    settings: { find },
    channels: { findActiveChannel },
    cipher: { decrypt } as unknown as ConstructorParameters<
      typeof NotifyInfrastructureAlert
    >[0]['cipher'],
    sender: { send },
    directory: { listRootContacts },
    mailer: { sendInfrastructureAlert },
    deliveries: {
      wasDelivered: (eventId, key) => Promise.resolve(delivered.has(`${eventId}|${key}`)),
      markDelivered,
    },
  });
  return { handler, findActiveChannel, decrypt, send, sendInfrastructureAlert, markDelivered };
}

const validEvent = (code = 'job_failed') => ({
  eventId: EVENT_ID,
  organizationId: ORGANIZATION_ID,
  payload: { code, occurredAt: OCCURRED_AT },
});

describe('NotifyInfrastructureAlert', () => {
  it('decrypts the token with the integration context and sends a fixed text to the chat', async () => {
    const { handler, decrypt, send, findActiveChannel } = buildHandler({ channel: CHANNEL });

    await handler.handle(validEvent());

    expect(findActiveChannel).toHaveBeenCalledWith('telegram_infra');
    expect(decrypt.mock.calls[0]).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        resourceId: INTEGRATION_ID,
        field: 'integration.bot_token',
        version: 3,
      },
      CHANNEL.botToken,
    ]);
    const sent = send.mock.calls[0]?.[0];
    expect(sent?.botToken).toBe(BOT_TOKEN);
    expect(sent?.chatId).toBe(CHAT_ID);
    expect(sent?.text).toContain('Compass');
    expect(sent?.text).toContain(OCCURRED_AT);
  });

  it('rejects as non-retryable when Telegram is the only channel and none is active', async () => {
    const { handler, decrypt, send } = buildHandler({ channel: null });

    await expect(handler.handle(validEvent())).rejects.toMatchObject({
      code: 'INTEGRATIONS.ALERT_CONFIG_INVALID',
      retryable: false,
    });
    expect(decrypt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown code', { code: 'free_text', occurredAt: OCCURRED_AT }],
    ['a missing date', { code: 'job_failed' }],
    ['an invalid date', { code: 'job_failed', occurredAt: 'ayer' }],
    ['a non-object payload', 'job_failed'],
  ])(
    'rejects %s as a non-retryable payload without touching the channel',
    async (_name, payload) => {
      const { handler, findActiveChannel } = buildHandler({ channel: CHANNEL });

      await expect(
        handler.handle({ eventId: EVENT_ID, organizationId: ORGANIZATION_ID, payload }),
      ).rejects.toMatchObject({ code: 'INTEGRATIONS.ALERT_PAYLOAD_INVALID', retryable: false });
      expect(findActiveChannel).not.toHaveBeenCalled();
    },
  );

  it('never puts event data into the message: an extra payload field is ignored', async () => {
    const { handler, send } = buildHandler({ channel: CHANNEL });

    await handler.handle({
      eventId: EVENT_ID,
      organizationId: ORGANIZATION_ID,
      payload: { code: 'job_failed', occurredAt: OCCURRED_AT, detail: 'postgres://u:p@host/db' },
    });

    expect(send.mock.calls[0]?.[0].text).not.toContain('postgres');
  });

  it('throws a retryable error when the token cannot be opened, without sending', async () => {
    const { handler, send } = buildHandler({ channel: CHANNEL, decryptOk: false });

    await expect(handler.handle(validEvent())).rejects.toMatchObject({
      code: 'INTEGRATIONS.ALERT_SECRET_UNAVAILABLE',
      retryable: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, code: 'RATE_LIMITED', retryable: true } as const, true],
    [{ ok: false, code: 'CREDENTIALS_REJECTED', retryable: false } as const, false],
  ])(
    'maps a failed send to a delivery error with the sender retry flag',
    async (sendResult, retryable) => {
      const { handler } = buildHandler({ channel: CHANNEL, sendResult });

      const failure: unknown = await handler.handle(validEvent()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(InfrastructureAlertDeliveryError);
      expect(failure).toMatchObject({ code: 'INTEGRATIONS.ALERT_SEND_FAILED', retryable });
      expect(JSON.stringify(failure)).not.toContain(BOT_TOKEN);
      expect((failure as Error).message).not.toContain(CHAT_ID);
    },
  );

  it('sends by email and Telegram by default, each Root in her own language', async () => {
    const { handler, send, sendInfrastructureAlert } = buildHandler({
      channel: CHANNEL,
      channels: { email: true, telegram: true },
      roots: [ROOT_A, ROOT_B],
    });

    await handler.handle(validEvent());

    expect(send).toHaveBeenCalledTimes(1);
    expect(sendInfrastructureAlert.mock.calls.map(([message]) => message)).toEqual([
      { to: ROOT_A.email, locale: 'es-MX', code: 'job_failed', occurredAt: new Date(OCCURRED_AT) },
      { to: ROOT_B.email, locale: 'en-US', code: 'job_failed', occurredAt: new Date(OCCURRED_AT) },
    ]);
  });

  it('sends only by email when Telegram is off, without touching the channel', async () => {
    const { handler, findActiveChannel, send, sendInfrastructureAlert } = buildHandler({
      channel: CHANNEL,
      channels: { email: true, telegram: false },
    });

    await handler.handle(validEvent());

    expect(findActiveChannel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(sendInfrastructureAlert).toHaveBeenCalledTimes(1);
  });

  it('sends only by email when both are on but no Telegram channel is active', async () => {
    const { handler, sendInfrastructureAlert } = buildHandler({
      channel: null,
      channels: { email: true, telegram: true },
    });

    await expect(handler.handle(validEvent())).resolves.toBeUndefined();
    expect(sendInfrastructureAlert).toHaveBeenCalledTimes(1);
  });

  it('rejects as non-retryable when email is the only channel and there is no active Root', async () => {
    const { handler } = buildHandler({ channels: { email: true, telegram: false }, roots: [] });

    await expect(handler.handle(validEvent())).rejects.toMatchObject({
      code: 'INTEGRATIONS.ALERT_CONFIG_INVALID',
      retryable: false,
    });
  });

  it('still sends to Telegram when one email fails, and asks for a retry', async () => {
    const { handler, send, markDelivered } = buildHandler({
      channel: CHANNEL,
      channels: { email: true, telegram: true },
      roots: [ROOT_A, ROOT_B],
      failingRecipients: [ROOT_B.email],
    });

    await expect(handler.handle(validEvent())).rejects.toMatchObject({
      code: 'INTEGRATIONS.ALERT_SEND_FAILED',
      retryable: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(markDelivered.mock.calls.map(([, key]) => key).sort()).toEqual([
      `integration.infra-alert:email:${ROOT_A.id}`,
      'integration.infra-alert:telegram',
    ]);
  });

  it('on retry skips the destinations already delivered', async () => {
    const { handler, send, sendInfrastructureAlert } = buildHandler({
      channel: CHANNEL,
      channels: { email: true, telegram: true },
      roots: [ROOT_A, ROOT_B],
      alreadyDelivered: [
        `${EVENT_ID}|integration.infra-alert:telegram`,
        `${EVENT_ID}|integration.infra-alert:email:${ROOT_A.id}`,
      ],
    });

    await handler.handle(validEvent());

    expect(send).not.toHaveBeenCalled();
    expect(sendInfrastructureAlert.mock.calls.map(([message]) => message.to)).toEqual([
      ROOT_B.email,
    ]);
  });

  it('does not quarantine when Telegram fails permanently but the email reached the Roots', async () => {
    const { handler, sendInfrastructureAlert } = buildHandler({
      channel: CHANNEL,
      channels: { email: true, telegram: true },
      sendResult: { ok: false, code: 'CREDENTIALS_REJECTED', retryable: false },
    });

    await expect(handler.handle(validEvent())).resolves.toBeUndefined();
    expect(sendInfrastructureAlert).toHaveBeenCalledTimes(1);
  });

  it('asks for a retry when email fails transiently even if Telegram failed permanently', async () => {
    const { handler } = buildHandler({
      channel: CHANNEL,
      channels: { email: true, telegram: true },
      sendResult: { ok: false, code: 'CREDENTIALS_REJECTED', retryable: false },
      failingRecipients: [ROOT_A.email],
    });

    await expect(handler.handle(validEvent())).rejects.toMatchObject({
      code: 'INTEGRATIONS.ALERT_SEND_FAILED',
      retryable: true,
    });
  });
});
