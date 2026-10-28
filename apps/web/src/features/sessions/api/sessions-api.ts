import { sessionSummarySchema } from '@iam/contracts';

import { apiClient, createListFetcher, noContentSchema, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de las sesiones propias (docs/frontend.md §7.3). */
export const sessionsKeys = {
  all: ['sessions'] as const,
  mine: () => [...sessionsKeys.all, 'mine'] as const,
};

/** `GET /me/sessions?cursor=&limit=`: las sesiones vivas de quien consulta, de la más reciente. */
export const fetchMySessionsPage = createListFetcher(
  apiClient,
  '/me/sessions',
  sessionSummarySchema,
);

/** `POST /me/sessions/:id/revoke` (204): cierra OTRA sesión propia; la actual se cierra con logout. */
export function revokeMySession(id: string, client: ApiClient = apiClient) {
  return client.post(`/me/sessions/${id}/revoke`, noContentSchema);
}
