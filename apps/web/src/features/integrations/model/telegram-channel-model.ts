import type { TelegramIntegration } from '@iam/contracts';
import { z } from 'zod';

/** Canal de Telegram de las alertas de infraestructura (solo Raíz, ADR 0047). */
export const TELEGRAM_INFRA_KIND = 'telegram_infra' as const;

/** Mismo tope que el CHECK de `integrations.name` en el servidor. */
const CHANNEL_NAME_MAX_LENGTH = 200;

/**
 * Formato que BotFather entrega: «<id numérico del bot>:<clave>». Es solo comodidad para avisar antes de
 * enviar; el servidor valida de nuevo y decide siempre.
 */
const BOT_TOKEN_PATTERN = /^\d{1,20}:[A-Za-z0-9_-]{20,100}$/;

/** Telegram identifica los chats con enteros (negativos para grupos y canales), nunca con un nombre. */
const CHAT_ID_PATTERN = /^-?\d{1,20}$/;

const nameSchema = z.string().trim().min(1).max(CHANNEL_NAME_MAX_LENGTH);
const chatIdSchema = z.string().trim().regex(CHAT_ID_PATTERN);
const botTokenSchema = z.string().trim().regex(BOT_TOKEN_PATTERN);

export const createTelegramChannelFormSchema = z.object({
  name: nameSchema,
  chatId: chatIdSchema,
  botToken: botTokenSchema,
});
export type CreateTelegramChannelFormValues = z.input<typeof createTelegramChannelFormSchema>;

/**
 * Al editar no se pide el token (se cambia aparte), pero el formulario comparte la forma de los valores
 * con el de alta para usar un solo resolvedor tipado; el campo viaja vacío y nunca se envía.
 */
export const editTelegramChannelFormSchema = z.object({
  name: nameSchema,
  chatId: chatIdSchema,
  botToken: z.string(),
});

export const rotateTelegramTokenFormSchema = z.object({ botToken: botTokenSchema });
export type RotateTelegramTokenFormValues = z.input<typeof rotateTelegramTokenFormSchema>;

/** Códigos estables que devuelve la prueba de envío cuando Telegram no la entregó. */
export const TELEGRAM_TEST_FAILURE_CODES = [
  'CREDENTIALS_REJECTED',
  'CHAT_REJECTED',
  'RATE_LIMITED',
  'UNAVAILABLE',
] as const;
export type TelegramTestFailureCode = (typeof TELEGRAM_TEST_FAILURE_CODES)[number];

export function isTelegramTestFailureCode(outcome: string): outcome is TelegramTestFailureCode {
  return (TELEGRAM_TEST_FAILURE_CODES as readonly string[]).includes(outcome);
}

/** El canal de infraestructura vigente: el servidor admite uno activo por tipo, los archivados no cuentan. */
export function findActiveInfraChannel(
  integrations: readonly TelegramIntegration[],
): TelegramIntegration | undefined {
  return integrations.find(
    (integration) => integration.kind === TELEGRAM_INFRA_KIND && integration.status === 'active',
  );
}
