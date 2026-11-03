import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId } from '../../../shared/kernel/index.js';
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

function buildHandler(options: {
  channel?: ActiveTelegramChannel | null;
  decryptOk?: boolean;
  sendResult?: TelegramSendResult;
}) {
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
  const handler = new NotifyInfrastructureAlert({
    channels: { findActiveChannel },
    cipher: { decrypt } as unknown as ConstructorParameters<
      typeof NotifyInfrastructureAlert
    >[0]['cipher'],
    sender: { send },
  });
  return { handler, findActiveChannel, decrypt, send };
}

const validEvent = (code = 'job_failed') => ({
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

  it('does nothing when the organization has no active infrastructure channel', async () => {
    const { handler, decrypt, send } = buildHandler({ channel: null });

    await expect(handler.handle(validEvent())).resolves.toBeUndefined();

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
        handler.handle({ organizationId: ORGANIZATION_ID, payload }),
      ).rejects.toMatchObject({ code: 'INTEGRATIONS.ALERT_PAYLOAD_INVALID', retryable: false });
      expect(findActiveChannel).not.toHaveBeenCalled();
    },
  );

  it('never puts event data into the message: an extra payload field is ignored', async () => {
    const { handler, send } = buildHandler({ channel: CHANNEL });

    await handler.handle({
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
});
