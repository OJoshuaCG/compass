import { describe, expect, it, vi } from 'vitest';

import type {
  OutboundHttpsClient,
  OutboundHttpsRequest,
  OutboundHttpsResult,
} from '../application/ports/outbound-https-client.js';
import { TelegramBotSender } from './telegram-bot-sender.js';

const VALID_TOKEN = '123456789:AAFakeTokenForTestsOnly_0123456789abcd';
const CHAT_ID = '-100200300';

function buildClient(result: OutboundHttpsResult) {
  const send = vi.fn<(request: OutboundHttpsRequest) => Promise<OutboundHttpsResult>>(() =>
    Promise.resolve(result),
  );
  const client: OutboundHttpsClient = { send };
  return { client, send };
}

describe('TelegramBotSender', () => {
  it('envía a la dirección fija de Telegram con el cuerpo en JSON y sin modo de formato', async () => {
    const { client, send } = buildClient({ ok: true, status: 200, bodyText: '{"ok":true}' });

    const result = await new TelegramBotSender(client).send({
      botToken: VALID_TOKEN,
      chatId: CHAT_ID,
      text: 'a***@c***.com reveló una credencial',
    });

    expect(result).toEqual({ ok: true });
    const sent = send.mock.calls[0]?.[0];
    expect(sent?.url).toBe(`https://api.telegram.org/bot${VALID_TOKEN}/sendMessage`);
    expect(sent?.method).toBe('POST');
    const body = JSON.parse(sent?.body ?? '{}') as Record<string, unknown>;
    expect(body).toEqual({
      chat_id: CHAT_ID,
      text: 'a***@c***.com reveló una credencial',
      disable_web_page_preview: true,
    });
    expect(body).not.toHaveProperty('parse_mode');
  });

  it('recorta el texto al límite de Telegram sin partir un carácter de dos unidades', async () => {
    const { client, send } = buildClient({ ok: true, status: 200, bodyText: '{}' });

    await new TelegramBotSender(client).send({
      botToken: VALID_TOKEN,
      chatId: CHAT_ID,
      text: '𠮷'.repeat(5000),
    });

    const body = JSON.parse(send.mock.calls[0]?.[0].body ?? '{}') as { text: string };
    expect(Array.from(body.text)).toHaveLength(4096);
  });

  it.each(['sin-formato', '123:corto', '123456789:AAFake/../../otra-ruta-0123456789', ''])(
    'rechaza el token mal formado %j sin llamar a la red',
    async (badToken: string) => {
      const { client, send } = buildClient({ ok: true, status: 200, bodyText: '{}' });

      const result = await new TelegramBotSender(client).send({
        botToken: badToken,
        chatId: CHAT_ID,
        text: 'x',
      });

      expect(result).toEqual({ ok: false, code: 'CREDENTIALS_REJECTED', retryable: false });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    [401, 'CREDENTIALS_REJECTED', false],
    [404, 'CREDENTIALS_REJECTED', false],
    [403, 'CHAT_REJECTED', false],
    [400, 'CHAT_REJECTED', false],
    [429, 'RATE_LIMITED', true],
    [500, 'UNAVAILABLE', true],
    [502, 'UNAVAILABLE', true],
  ])('clasifica la respuesta %i como %s (reintentable: %s)', async (status, code, isRetryable) => {
    const { client } = buildClient({ ok: true, status, bodyText: '{}' });

    const result = await new TelegramBotSender(client).send({
      botToken: VALID_TOKEN,
      chatId: CHAT_ID,
      text: 'x',
    });

    expect(result).toEqual({ ok: false, code, retryable: isRetryable });
  });

  it('trata un fallo de red, de tiempo o de destino como reintentable', async () => {
    for (const code of [
      'TIMEOUT',
      'NETWORK_ERROR',
      'HOST_NOT_ALLOWED',
      'REDIRECT_REFUSED',
    ] as const) {
      const { client } = buildClient({ ok: false, code });

      const result = await new TelegramBotSender(client).send({
        botToken: VALID_TOKEN,
        chatId: CHAT_ID,
        text: 'x',
      });

      expect(result).toEqual({ ok: false, code: 'UNAVAILABLE', retryable: true });
    }
  });

  it('nunca devuelve el token ni el chat en el resultado de un fallo', async () => {
    const { client } = buildClient({ ok: true, status: 401, bodyText: VALID_TOKEN });

    const result = await new TelegramBotSender(client).send({
      botToken: VALID_TOKEN,
      chatId: CHAT_ID,
      text: 'x',
    });

    expect(JSON.stringify(result)).not.toContain(VALID_TOKEN);
    expect(JSON.stringify(result)).not.toContain(CHAT_ID);
  });
});
