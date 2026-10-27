import { passkeySchema } from '@iam/contracts';
import { z } from 'zod';

import { apiClient, noContentSchema, type ApiClient } from '../../../shared/api';

/**
 * Fábrica de claves de las passkeys propias (docs/frontend.md §7.3). En la caché solo hay lo que
 * el servidor lista (nombre y fechas): nunca llaves, atestaciones ni aserciones.
 */
export const passkeysKeys = {
  all: ['passkeys'] as const,
  mine: () => [...passkeysKeys.all, 'mine'] as const,
};

const passkeysResponseSchema = z.object({ data: z.array(passkeySchema) });

/** `GET /me/passkeys`: las passkeys de quien consulta. */
export async function fetchMyPasskeys(signal: AbortSignal, client: ApiClient = apiClient) {
  const response = await client.get('/me/passkeys', passkeysResponseSchema, { signal });
  return response.data;
}

/** `POST /me/passkeys/:id/revoke` (204; exige reautenticación reciente, que el cliente gestiona). */
export function revokeMyPasskey(id: string, client: ApiClient = apiClient) {
  return client.post(`/me/passkeys/${id}/revoke`, noContentSchema);
}
