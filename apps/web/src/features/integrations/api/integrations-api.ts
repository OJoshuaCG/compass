import {
  alertSettingsSchema,
  telegramIntegrationSchema,
  telegramIntegrationsResponseSchema,
  telegramTestResultSchema,
  type AlertSettings,
  type CreateTelegramIntegrationRequest,
  type InfrastructureAlertChannels,
  type TelegramIntegration,
  type TelegramIntegrationsResponse,
  type TelegramTestResult,
  type UpdateTelegramIntegrationRequest,
} from '@iam/contracts';

import { apiClient, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de integraciones (docs/frontend.md §7.3). */
export const integrationsKeys = {
  all: ['integrations'] as const,
  alertSettings: () => [...integrationsKeys.all, 'alert-settings'] as const,
  telegram: () => [...integrationsKeys.all, 'telegram'] as const,
};

const ALERT_SETTINGS_PATH = '/integrations/alert-settings';

/** `GET /integrations/alert-settings` (permiso `alerts.infra.manage`). Sin fila guardada responde `version` 0. */
export function fetchAlertSettings(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<AlertSettings> {
  return client.get(ALERT_SETTINGS_PATH, alertSettingsSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * `PUT /integrations/alert-settings` (permiso `alerts.infra.manage`, reautenticación reciente).
 * `expectedVersion` es la versión que la persona vio al cargar: si otra persona guardó antes, el
 * servidor responde `CONFLICT.VERSION`. La reautenticación la abre el cliente base y reintenta una vez.
 */
export function saveAlertSettings(
  infrastructure: InfrastructureAlertChannels,
  expectedVersion: number,
  client: ApiClient = apiClient,
): Promise<AlertSettings> {
  return client.put(ALERT_SETTINGS_PATH, alertSettingsSchema, {
    body: { infrastructure, expectedVersion },
  });
}

const TELEGRAM_PATH = '/integrations/telegram';

/**
 * `GET /integrations/telegram` (permiso del canal). La respuesta nunca lleva el token, solo
 * `hasBotToken`, así que puede pasar por Query.
 */
export function fetchTelegramIntegrations(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<TelegramIntegrationsResponse> {
  return client.get(TELEGRAM_PATH, telegramIntegrationsResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * `POST /integrations/telegram` (reautenticación reciente). El token viaja una sola vez en el cuerpo:
 * el llamador no lo guarda en Query ni en ningún almacenamiento.
 */
export function createTelegramIntegration(
  body: CreateTelegramIntegrationRequest,
  client: ApiClient = apiClient,
): Promise<TelegramIntegration> {
  return client.post(TELEGRAM_PATH, telegramIntegrationSchema, { body });
}

/** `PUT /integrations/telegram/:id`: nombre y chat. El token se cambia aparte. */
export function updateTelegramIntegration(
  id: string,
  body: UpdateTelegramIntegrationRequest,
  client: ApiClient = apiClient,
): Promise<TelegramIntegration> {
  return client.put(`${TELEGRAM_PATH}/${id}`, telegramIntegrationSchema, { body });
}

/** `PUT /integrations/telegram/:id/bot-token`: guarda un token nuevo (cifrado en el servidor). */
export function rotateTelegramBotToken(
  id: string,
  botToken: string,
  client: ApiClient = apiClient,
): Promise<TelegramIntegration> {
  return client.put(`${TELEGRAM_PATH}/${id}/bot-token`, telegramIntegrationSchema, {
    body: { botToken },
  });
}

/** `POST /integrations/telegram/:id/test`: `sent` o el código estable de fallo, nunca el texto de Telegram. */
export function sendTelegramTest(
  id: string,
  client: ApiClient = apiClient,
): Promise<TelegramTestResult> {
  return client.post(`${TELEGRAM_PATH}/${id}/test`, telegramTestResultSchema);
}

/** `DELETE /integrations/telegram/:id`: archiva el canal; para volver a usarlo se crea otro. */
export function archiveTelegramIntegration(
  id: string,
  client: ApiClient = apiClient,
): Promise<TelegramIntegration> {
  return client.delete(`${TELEGRAM_PATH}/${id}`, telegramIntegrationSchema);
}
