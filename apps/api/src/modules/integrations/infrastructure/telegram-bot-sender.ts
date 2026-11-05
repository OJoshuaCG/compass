import { TELEGRAM_BOT_TOKEN_PATTERN } from '../domain/integration-config.js';
import type { OutboundHttpsClient } from '../application/ports/outbound-https-client.js';
import type {
  TelegramFailureCode,
  TelegramMessage,
  TelegramSendResult,
  TelegramSender,
} from '../application/ports/telegram-sender.js';

/** Host fijo: la persona aporta token y chat, nunca la dirección (ADR 0047). */
const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';
/** Límite de Telegram para el texto de un mensaje. */
const TELEGRAM_MAX_TEXT_CHARACTERS = 4096;
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

function retryable(code: TelegramFailureCode): TelegramSendResult {
  return { ok: false, code, retryable: true };
}

function permanent(code: TelegramFailureCode): TelegramSendResult {
  return { ok: false, code, retryable: false };
}

export class TelegramBotSender implements TelegramSender {
  constructor(private readonly httpsClient: OutboundHttpsClient) {}

  async send(message: TelegramMessage): Promise<TelegramSendResult> {
    // Un token mal formado nunca se concatena en la ruta: evita rutas inesperadas con `/` o `?`.
    if (!TELEGRAM_BOT_TOKEN_PATTERN.test(message.botToken))
      return permanent('CREDENTIALS_REJECTED');

    const text: string = Array.from(message.text).slice(0, TELEGRAM_MAX_TEXT_CHARACTERS).join('');
    const result = await this.httpsClient.send({
      url: `${TELEGRAM_API_ORIGIN}/bot${message.botToken}/sendMessage`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Sin `parse_mode`: el texto se muestra tal cual y no interpreta marcas.
      body: JSON.stringify({ chat_id: message.chatId, text, disable_web_page_preview: true }),
    });

    // Cualquier fallo de red, tiempo o destino se puede reintentar; la cola decide cuántas veces.
    if (!result.ok) return retryable('UNAVAILABLE');

    if (result.status === HTTP_STATUS_OK) return { ok: true };
    if (result.status === HTTP_STATUS_UNAUTHORIZED || result.status === HTTP_STATUS_NOT_FOUND) {
      return permanent('CREDENTIALS_REJECTED');
    }
    if (result.status === HTTP_STATUS_FORBIDDEN || result.status === HTTP_STATUS_BAD_REQUEST) {
      return permanent('CHAT_REJECTED');
    }
    if (result.status === HTTP_STATUS_TOO_MANY_REQUESTS) return retryable('RATE_LIMITED');
    return retryable('UNAVAILABLE');
  }
}
