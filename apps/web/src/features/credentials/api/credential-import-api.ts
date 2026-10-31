import {
  credentialImportPreviewSchema,
  credentialImportResultSchema,
  type ImportCredentialsRequest,
} from '@iam/contracts';

import { apiClient, type ApiClient } from '../../../shared/api';

/*
 * Sin fábrica de claves ni `useQuery`/`useMutation`: el cuerpo lleva el CSV con contraseñas y
 * Query lo conservaría en `variables` de la caché de mutaciones (docs/frontend.md §9). Estas
 * funciones se llaman con `useAsyncAction`.
 */

/** `POST /credentials/import/preview` (200, no escribe nada): valida y devuelve una fila por línea. */
export function previewCredentialImport(csv: string, client: ApiClient = apiClient) {
  const body: ImportCredentialsRequest = { csv };
  return client.post('/credentials/import/preview', credentialImportPreviewSchema, { body });
}

/** `POST /credentials/import` (201): todo o nada; con una fila inválida responde 422 y no escribe. */
export function commitCredentialImport(csv: string, client: ApiClient = apiClient) {
  const body: ImportCredentialsRequest = { csv };
  return client.post('/credentials/import', credentialImportResultSchema, { body });
}
