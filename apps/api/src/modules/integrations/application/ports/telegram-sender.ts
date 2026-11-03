/** Puerto de envío de un mensaje de Telegram (ADR 0047). El token viaja solo hacia el adaptador. */

export interface TelegramMessage {
  /** Token del bot de la persona. Es un secreto: nunca se registra ni se devuelve. */
  readonly botToken: string;
  /** Identificador del chat, vinculado por su dueño. Es un dato personal. */
  readonly chatId: string;
  /** Texto ya censurado y armado con campos de una lista cerrada. Se envía como texto plano. */
  readonly text: string;
}

/**
 * Códigos estables de fallo. `RATE_LIMITED` y `UNAVAILABLE` se pueden reintentar; los demás
 * indican una configuración que una persona debe corregir y no se reintentan.
 */
export const TELEGRAM_FAILURE_CODES = [
  'CREDENTIALS_REJECTED',
  'CHAT_REJECTED',
  'RATE_LIMITED',
  'UNAVAILABLE',
] as const;

export type TelegramFailureCode = (typeof TELEGRAM_FAILURE_CODES)[number];

export type TelegramSendResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: TelegramFailureCode; readonly retryable: boolean };

export interface TelegramSender {
  send(message: TelegramMessage): Promise<TelegramSendResult>;
}
