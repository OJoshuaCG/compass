import { z } from 'zod';

/** Canales de Telegram configurables (ADR 0047). El de infraestructura es solo de la Raíz. */
export const TELEGRAM_INTEGRATION_KIND_VALUES = ['telegram_infra', 'telegram_security'] as const;
export const telegramIntegrationKindSchema = z.enum(TELEGRAM_INTEGRATION_KIND_VALUES);
export type TelegramIntegrationKindValue = z.infer<typeof telegramIntegrationKindSchema>;

/**
 * Los esquemas solo acotan el tamaño: el formato del token y del chat lo valida el caso de uso, que
 * rechaza con `VALIDATION.FAILED` y el nombre del campo, sin devolver nunca el valor recibido.
 */
const botTokenInputSchema = z.string().min(1).max(200);
const chatIdInputSchema = z.string().min(1).max(40);
const integrationNameInputSchema = z.string().min(1).max(400);

export const createTelegramIntegrationRequestSchema = z.object({
  kind: telegramIntegrationKindSchema,
  name: integrationNameInputSchema,
  chatId: chatIdInputSchema,
  botToken: botTokenInputSchema,
});
export type CreateTelegramIntegrationRequest = z.infer<
  typeof createTelegramIntegrationRequestSchema
>;

export const updateTelegramIntegrationRequestSchema = z.object({
  name: integrationNameInputSchema,
  chatId: chatIdInputSchema,
});
export type UpdateTelegramIntegrationRequest = z.infer<
  typeof updateTelegramIntegrationRequestSchema
>;

export const rotateTelegramBotTokenRequestSchema = z.object({
  botToken: botTokenInputSchema,
});
export type RotateTelegramBotTokenRequest = z.infer<typeof rotateTelegramBotTokenRequestSchema>;

/** Una integración tal como se muestra: el token nunca sale, solo si existe uno guardado. */
export const telegramIntegrationSchema = z.object({
  id: z.uuid(),
  kind: telegramIntegrationKindSchema,
  name: z.string(),
  status: z.enum(['active', 'archived']),
  chatId: z.string().nullable(),
  hasBotToken: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TelegramIntegration = z.infer<typeof telegramIntegrationSchema>;

export const telegramIntegrationsResponseSchema = z.object({
  data: z.array(telegramIntegrationSchema),
});
export type TelegramIntegrationsResponse = z.infer<typeof telegramIntegrationsResponseSchema>;

/** Resultado de enviar un mensaje de prueba: `sent` o el código estable de fallo, nunca el texto de Telegram. */
export const telegramTestResultSchema = z.object({ outcome: z.string().min(1) });
export type TelegramTestResult = z.infer<typeof telegramTestResultSchema>;
