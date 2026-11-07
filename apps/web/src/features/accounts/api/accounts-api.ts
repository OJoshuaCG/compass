import {
  accountListItemSchema,
  accountSchema,
  accountTagsResponseSchema,
  platformSchema,
  type CreateAccountRequest,
  type UpdateAccountRequest,
} from '@iam/contracts';
import { z } from 'zod';

import { apiClient, createListFetcher, noContentSchema, type ApiClient } from '../../../shared/api';

/** Fábrica de claves de las cuentas (docs/frontend.md §7.3). */
export const accountsKeys = {
  all: ['accounts'] as const,
  /** Prefijo de los dos listados: una mutación invalida ambos de una vez. */
  lists: () => [...accountsKeys.all, 'list'] as const,
  mine: () => [...accountsKeys.lists(), 'mine'] as const,
  inventory: () => [...accountsKeys.lists(), 'inventory'] as const,
  platforms: () => [...accountsKeys.all, 'platforms'] as const,
  /** Etiquetas en uso: cambian con cada alta, edición o archivo, igual que los listados. */
  allTags: () => [...accountsKeys.all, 'tags'] as const,
  tags: (scope: AccountTagsScope) => [...accountsKeys.allTags(), scope] as const,
};

/** `mine`: de las cuentas con acceso efectivo. `inventory`: de todo el inventario (exige su permiso). */
export type AccountTagsScope = 'mine' | 'inventory';

/**
 * `GET /accounts?cursor=&limit=&q=&filter=&tag=`: las cuentas a las que quien consulta accede, cada una con
 * `myLevel` y el semáforo de antigüedad de su contraseña.
 */
export const fetchAccountsPage = createListFetcher(apiClient, '/accounts', accountListItemSchema);

/**
 * `GET /accounts/inventory?cursor=&limit=&q=&tag=` (exige `vault.inventory.read`): solo metadatos, con
 * `myLevel` en `null` y la antigüedad en `unknown`. Sin filtros rápidos: el servidor los rechaza.
 */
export const fetchInventoryPage = createListFetcher(
  apiClient,
  '/accounts/inventory',
  accountListItemSchema,
);

/**
 * `GET /accounts/tags` o `GET /accounts/inventory/tags`: etiquetas distintas en uso, ya ordenadas. Las
 * de `mine` salen solo de cuentas con acceso efectivo: nunca revelan etiquetas de cuentas ajenas.
 */
export async function fetchAccountTags(
  scope: AccountTagsScope,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const path = scope === 'mine' ? '/accounts/tags' : '/accounts/inventory/tags';
  const response = await client.get(path, accountTagsResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

const platformsResponseSchema = z.object({ data: z.array(platformSchema) });

/** `GET /platforms`: el catálogo completo (global y de la organización) en una sola respuesta, sin paginar. */
export async function fetchPlatforms(signal?: AbortSignal, client: ApiClient = apiClient) {
  const response = await client.get('/platforms', platformsResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/** `POST /accounts` (201, exige `account.create`): idempotente; 422 plataforma o grupo inválidos. */
export function createAccount(body: CreateAccountRequest, client: ApiClient = apiClient) {
  return client.post('/accounts', accountSchema, { body });
}

/**
 * `PATCH /accounts/:id` (200, exige `account.update` y nivel EDIT): reemplazo parcial. El servidor
 * marca la ruta como idempotente y rechaza la petición sin `Idempotency-Key`.
 */
export function updateAccount(
  id: string,
  body: UpdateAccountRequest,
  client: ApiClient = apiClient,
) {
  return client.patch(`/accounts/${id}`, accountSchema, {
    body,
    idempotencyKey: crypto.randomUUID(),
  });
}

/** `POST /accounts/:id/archive` (204, exige `account.archive` y nivel MANAGE). */
export function archiveAccount(id: string, client: ApiClient = apiClient) {
  return client.post(`/accounts/${id}/archive`, noContentSchema);
}
