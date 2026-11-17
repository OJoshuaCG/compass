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

/**
 * Canales de las alertas de infraestructura de la Raíz: correo y/o Telegram (decisión del dueño del
 * 2026-11-04). Al menos uno debe quedar encendido; lo valida el caso de uso.
 */
export const infrastructureAlertChannelsSchema = z.object({
  email: z.boolean(),
  telegram: z.boolean(),
});
export type InfrastructureAlertChannels = z.infer<typeof infrastructureAlertChannelsSchema>;

/** `version` 0 significa que aún no hay ajuste guardado y rige el valor por omisión (ambos encendidos). */
export const alertSettingsSchema = z.object({
  infrastructure: infrastructureAlertChannelsSchema,
  version: z.number().int().min(0),
  updatedAt: z.iso.datetime().nullable(),
});
export type AlertSettings = z.infer<typeof alertSettingsSchema>;

export const updateAlertSettingsRequestSchema = z.object({
  infrastructure: infrastructureAlertChannelsSchema,
  expectedVersion: z.number().int().min(0),
});
export type UpdateAlertSettingsRequest = z.infer<typeof updateAlertSettingsRequestSchema>;

/**
 * Servidor SMTP de una organización (ADR 0047, enmienda del 2026-11-17). Los esquemas solo acotan el
 * tamaño: host, puerto, seguridad y remitente los valida el caso de uso, que rechaza con
 * `VALIDATION.FAILED` y el nombre del campo, sin devolver nunca el valor recibido.
 */
export const SMTP_SECURITY_VALUES = ['starttls', 'tls'] as const;
export const smtpSecuritySchema = z.enum(SMTP_SECURITY_VALUES);
export type SmtpSecurityValue = z.infer<typeof smtpSecuritySchema>;

const smtpSettingsFieldsShape = {
  name: z.string().min(1).max(400),
  host: z.string().min(1).max(300),
  port: z.number().int().min(1).max(65_535),
  security: smtpSecuritySchema,
  username: z.string().min(1).max(300),
  fromAddress: z.string().min(1).max(320),
};
const smtpPasswordInputSchema = z.string().min(1).max(1024);

export const createSmtpSettingsRequestSchema = z.object({
  ...smtpSettingsFieldsShape,
  password: smtpPasswordInputSchema,
});
export type CreateSmtpSettingsRequest = z.infer<typeof createSmtpSettingsRequestSchema>;

export const updateSmtpSettingsRequestSchema = z.object(smtpSettingsFieldsShape);
export type UpdateSmtpSettingsRequest = z.infer<typeof updateSmtpSettingsRequestSchema>;

export const rotateSmtpPasswordRequestSchema = z.object({ password: smtpPasswordInputSchema });
export type RotateSmtpPasswordRequest = z.infer<typeof rotateSmtpPasswordRequestSchema>;

/** Un servidor SMTP tal como se muestra: la contraseña nunca sale, solo si existe una guardada. */
export const smtpSettingsSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['active', 'archived']),
  host: z.string(),
  port: z.number().int(),
  security: smtpSecuritySchema,
  username: z.string(),
  fromAddress: z.string(),
  hasPassword: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SmtpSettings = z.infer<typeof smtpSettingsSchema>;

export const smtpSettingsResponseSchema = z.object({ data: z.array(smtpSettingsSchema) });
export type SmtpSettingsResponse = z.infer<typeof smtpSettingsResponseSchema>;

/** Resultado de la prueba: `sent` o un código estable de fallo, nunca el texto del servidor SMTP. */
export const smtpTestResultSchema = z.object({ outcome: z.string().min(1) });
export type SmtpTestResult = z.infer<typeof smtpTestResultSchema>;
