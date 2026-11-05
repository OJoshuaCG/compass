import type { Permission } from '@iam/contracts';

/** Canales de Telegram que se configuran hoy. `sms_pull` llega con su propio caso de uso (T5). */
export const TELEGRAM_INTEGRATION_KINDS = ['telegram_infra', 'telegram_security'] as const;
export type TelegramIntegrationKind = (typeof TELEGRAM_INTEGRATION_KINDS)[number];

/**
 * Permiso que gobierna cada canal. Infraestructura es solo de la Raíz (techo 0); seguridad la puede
 * administrar también la persona Administradora (techo 1). El techo lo hace cumplir el catálogo.
 */
export const TELEGRAM_KIND_PERMISSION: Readonly<Record<TelegramIntegrationKind, Permission>> = {
  telegram_infra: 'alerts.infra.manage',
  telegram_security: 'alerts.security.manage',
};

/** Un token de bot tiene la forma `<número>:<cadena>`; sirve para no armar rutas con basura. */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{1,20}:[A-Za-z0-9_-]{20,100}$/;

/** Telegram identifica chats con enteros (negativos para grupos y canales); nunca un nombre ni una URL. */
export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{1,20}$/;

/** Mismo tope que el CHECK de `integrations.name`. */
export const INTEGRATION_NAME_MAX_LENGTH = 200;

export function isTelegramIntegrationKind(value: string): value is TelegramIntegrationKind {
  return (TELEGRAM_INTEGRATION_KINDS as readonly string[]).includes(value);
}

/** El nombre sin espacios sobrantes, o `null` si queda vacío o excede el tope. */
export function normalizeIntegrationName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > INTEGRATION_NAME_MAX_LENGTH) return null;
  return name;
}
