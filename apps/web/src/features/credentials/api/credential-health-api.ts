import { credentialHealthSchema } from '@iam/contracts';
import { z } from 'zod';

import { apiClient, type ApiClient } from '../../../shared/api';

/**
 * Claves de la salud de credenciales (docs/frontend.md §7.3). Van aparte de `credentialsKeys`
 * porque la salud es secundaria: invalidarla o fallar no debe tocar el listado. En la caché solo
 * hay señales y puntaje de fortaleza, nunca un secreto.
 */
export const credentialHealthKeys = {
  all: ['credential-health'] as const,
  account: (accountId: string) => [...credentialHealthKeys.all, 'account', accountId] as const,
};

const healthResponseSchema = z.object({ data: z.array(credentialHealthSchema) });

/** `GET /accounts/:id/health`: señales de riesgo y puntaje de cada credencial de la cuenta. */
export async function fetchAccountHealth(
  accountId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const response = await client.get(`/accounts/${accountId}/health`, healthResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}
