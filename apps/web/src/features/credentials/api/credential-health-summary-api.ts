import { credentialHealthSummarySchema } from '@iam/contracts';
import { z } from 'zod';

import { apiClient, type ApiClient } from '../../../shared/api';

import { credentialHealthKeys } from './credential-health-api';

/**
 * Claves de los paneles de salud (docs/frontend.md §7.3). Cuelgan de la misma raíz que la salud por
 * cuenta para poder invalidarlas juntas, pero cada panel tiene su clave. En la caché solo hay
 * conteos: nunca nombres, etiquetas ni secretos.
 */
export const credentialHealthSummaryKeys = {
  organization: () => [...credentialHealthKeys.all, 'organization'] as const,
  group: (groupId: string) => [...credentialHealthKeys.all, 'group', groupId] as const,
};

const summaryResponseSchema = z.object({ data: credentialHealthSummarySchema });

/** `GET /credential-health/organization` (Administrador o rango superior; lo decide el servidor). */
export async function fetchOrganizationHealthSummary(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get('/credential-health/organization', summaryResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/** `GET /credential-health/groups/:groupId`: `GROUP.NOT_FOUND` si quien consulta no ve el grupo. */
export async function fetchGroupHealthSummary(
  groupId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get(`/credential-health/groups/${groupId}`, summaryResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}
