import {
  alertSettingsSchema,
  type AlertSettings,
  type InfrastructureAlertChannels,
} from '@iam/contracts';

import { apiClient, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de integraciones (docs/frontend.md §7.3). */
export const integrationsKeys = {
  all: ['integrations'] as const,
  alertSettings: () => [...integrationsKeys.all, 'alert-settings'] as const,
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
