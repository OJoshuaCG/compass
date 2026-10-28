import { passkeySchema } from '@iam/contracts';

import { apiClient, createListFetcher, noContentSchema, type ApiClient } from '../../../shared/api';

/**
 * Fábrica de claves de las passkeys propias (docs/frontend.md §7.3). En la caché solo hay lo que
 * el servidor lista (nombre y fechas): nunca llaves, atestaciones ni aserciones.
 */
export const passkeysKeys = {
  all: ['passkeys'] as const,
  mine: () => [...passkeysKeys.all, 'mine'] as const,
};

/** `GET /me/passkeys?cursor=&limit=`: las passkeys de quien consulta, de la más antigua. */
export const fetchMyPasskeysPage = createListFetcher(apiClient, '/me/passkeys', passkeySchema);

/** `POST /me/passkeys/:id/revoke` (204; exige reautenticación reciente, que el cliente gestiona). */
export function revokeMyPasskey(id: string, client: ApiClient = apiClient) {
  return client.post(`/me/passkeys/${id}/revoke`, noContentSchema);
}
