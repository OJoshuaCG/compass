import { sessionSummarySchema } from '@iam/contracts';
import { z } from 'zod';

import { apiClient, noContentSchema, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de las sesiones propias (docs/frontend.md §7.3). */
export const sessionsKeys = {
  all: ['sessions'] as const,
  mine: () => [...sessionsKeys.all, 'mine'] as const,
};

const sessionsResponseSchema = z.object({ data: z.array(sessionSummarySchema) });

/** `GET /me/sessions`: las sesiones vivas de quien consulta. */
export async function fetchMySessions(signal: AbortSignal, client: ApiClient = apiClient) {
  const response = await client.get('/me/sessions', sessionsResponseSchema, { signal });
  return response.data;
}

/** `POST /me/sessions/:id/revoke` (204): cierra OTRA sesión propia; la actual se cierra con logout. */
export function revokeMySession(id: string, client: ApiClient = apiClient) {
  return client.post(`/me/sessions/${id}/revoke`, noContentSchema);
}
